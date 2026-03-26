import { AdvancedRateLimiter, RateLimitConfig, RateLimitResult } from './AdvancedRateLimiter';
import { WinstonLogger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

export enum UserTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
  CUSTOM = 'custom'
}

export interface TierConfig {
  tier: UserTier;
  name: string;
  description: string;
  limits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    requestsPerMonth: number;
  };
  features: {
    burstAllowance: number;
    prioritySupport: boolean;
    customEndpoints: boolean;
    advancedAnalytics: boolean;
    emergencyBypass: boolean;
  };
  pricing?: {
    monthly: number;
    yearly: number;
    currency: string;
  };
}

export interface UserTierInfo {
  userId: string;
  tier: UserTier;
  customLimits?: {
    [endpoint: string]: {
      requestsPerMinute: number;
      requestsPerHour: number;
      requestsPerDay: number;
    };
  };
  specialFeatures?: {
    burstMultiplier: number;
    priorityMultiplier: number;
    bypassLimits: boolean;
  };
  expiresAt?: number;
}

export interface TieredRateLimitResult {
  allowed: boolean;
  tier: UserTier;
  limits: {
    minute: { used: number; limit: number; resetTime: number };
    hour: { used: number; limit: number; resetTime: number };
    day: { used: number; limit: number; resetTime: number };
    month: { used: number; limit: number; resetTime: number };
  };
  features: {
    burstRemaining: number;
    priorityAccess: boolean;
    customAccess: boolean;
    analyticsAccess: boolean;
  };
  retryAfter?: number;
}

export class TieredRateLimiter extends EventEmitter {
  private advancedLimiter: AdvancedRateLimiter;
  private logger: WinstonLogger;
  private tierConfigs: Map<UserTier, TierConfig> = new Map();
  private userTiers: Map<string, UserTierInfo> = new Map();

  constructor(advancedLimiter: AdvancedRateLimiter) {
    super();
    this.advancedLimiter = advancedLimiter;
    this.logger = new WinstonLogger();
    this.initializeDefaultTiers();
  }

  private initializeDefaultTiers(): void {
    const defaultTiers: TierConfig[] = [
      {
        tier: UserTier.FREE,
        name: 'Free Tier',
        description: 'Basic access with limited requests',
        limits: {
          requestsPerMinute: 10,
          requestsPerHour: 100,
          requestsPerDay: 1000,
          requestsPerMonth: 10000
        },
        features: {
          burstAllowance: 0,
          prioritySupport: false,
          customEndpoints: false,
          advancedAnalytics: false,
          emergencyBypass: false
        }
      },
      {
        tier: UserTier.BASIC,
        name: 'Basic Tier',
        description: 'Enhanced access for regular users',
        limits: {
          requestsPerMinute: 30,
          requestsPerHour: 500,
          requestsPerDay: 5000,
          requestsPerMonth: 50000
        },
        features: {
          burstAllowance: 10,
          prioritySupport: false,
          customEndpoints: false,
          advancedAnalytics: true,
          emergencyBypass: false
        },
        pricing: {
          monthly: 9.99,
          yearly: 99.99,
          currency: 'USD'
        }
      },
      {
        tier: UserTier.PREMIUM,
        name: 'Premium Tier',
        description: 'Professional access with premium features',
        limits: {
          requestsPerMinute: 100,
          requestsPerHour: 2000,
          requestsPerDay: 20000,
          requestsPerMonth: 200000
        },
        features: {
          burstAllowance: 50,
          prioritySupport: true,
          customEndpoints: true,
          advancedAnalytics: true,
          emergencyBypass: false
        },
        pricing: {
          monthly: 49.99,
          yearly: 499.99,
          currency: 'USD'
        }
      },
      {
        tier: UserTier.ENTERPRISE,
        name: 'Enterprise Tier',
        description: 'Unlimited access for enterprise customers',
        limits: {
          requestsPerMinute: 1000,
          requestsPerHour: 10000,
          requestsPerDay: 100000,
          requestsPerMonth: 1000000
        },
        features: {
          burstAllowance: 500,
          prioritySupport: true,
          customEndpoints: true,
          advancedAnalytics: true,
          emergencyBypass: true
        },
        pricing: {
          monthly: 499.99,
          yearly: 4999.99,
          currency: 'USD'
        }
      }
    ];

    defaultTiers.forEach(tier => {
      this.tierConfigs.set(tier.tier, tier);
    });
  }

  setTierConfig(config: TierConfig): void {
    this.tierConfigs.set(config.tier, config);
    this.logger.info('Tier config updated', { tier: config.tier });
  }

  getTierConfig(tier: UserTier): TierConfig | undefined {
    return this.tierConfigs.get(tier);
  }

  setUserTier(userInfo: UserTierInfo): void {
    this.userTiers.set(userInfo.userId, userInfo);
    this.logger.info('User tier updated', { 
      userId: userInfo.userId, 
      tier: userInfo.tier 
    });
  }

  getUserTier(userId: string): UserTierInfo | undefined {
    return this.userTiers.get(userId);
  }

  async checkTieredRateLimit(
    userId: string,
    endpoint: string,
    req?: any,
    res?: any
  ): Promise<TieredRateLimitResult> {
    const userInfo = this.getUserTier(userId);
    
    // Default to free tier if no user info found
    const defaultUserInfo: UserTierInfo = {
      userId,
      tier: UserTier.FREE
    };
    
    const userTierInfo = userInfo || defaultUserInfo;
    const tierConfig = this.getTierConfig(userTierInfo.tier);
    
    if (!tierConfig) {
      this.logger.error('Tier config not found', { tier: userTierInfo.tier });
      throw new Error(`Tier configuration not found for tier: ${userTierInfo.tier}`);
    }

    // Check for emergency bypass
    if (tierConfig.features.emergencyBypass || userTierInfo.specialFeatures?.bypassLimits) {
      return this.createBypassResult(userTierInfo.tier, tierConfig);
    }

    // Apply custom limits if available
    const effectiveLimits = this.calculateEffectiveLimits(userTierInfo, tierConfig);

    // Check rate limits for different time windows
    const keys = {
      minute: `rate_limit:tiered:${userId}:minute`,
      hour: `rate_limit:tiered:${userId}:hour`,
      day: `rate_limit:tiered:${userId}:day`,
      month: `rate_limit:tiered:${userId}:month`
    };

    // Check endpoint-specific custom limits
    const endpointCustomLimit = userTierInfo.customLimits?.[endpoint];
    if (endpointCustomLimit) {
      const endpointKey = `rate_limit:tiered:${userId}:endpoint:${endpoint}`;
      const endpointResult = await this.advancedLimiter.checkRateLimit(endpointKey, {
        windowMs: 60 * 1000,
        max: endpointCustomLimit.requestsPerMinute,
        onLimitReached: (req, res) => {
          this.logger.warn('User endpoint custom limit exceeded', {
            userId,
            endpoint,
            limit: endpointCustomLimit.requestsPerMinute,
            tier: userTierInfo.tier
          });
        }
      }, req, res);

      if (!endpointResult.allowed) {
        return this.createExceededResult(
          userTierInfo.tier,
          tierConfig,
          endpointResult.retryAfter,
          'endpoint'
        );
      }
    }

    // Check minute limit
    const minuteResult = await this.advancedLimiter.checkRateLimit(keys.minute, {
      windowMs: 60 * 1000,
      max: effectiveLimits.requestsPerMinute,
      onLimitReached: (req, res) => {
        this.logger.warn('Tier minute limit exceeded', {
          userId,
          tier: userTierInfo.tier,
          limit: effectiveLimits.requestsPerMinute
        });
      }
    }, req, res);

    if (!minuteResult.allowed) {
      return this.createExceededResult(
        userTierInfo.tier,
        tierConfig,
        minuteResult.retryAfter,
        'minute'
      );
    }

    // Check hour limit
    const hourResult = await this.advancedLimiter.checkRateLimit(keys.hour, {
      windowMs: 60 * 60 * 1000,
      max: effectiveLimits.requestsPerHour,
      onLimitReached: (req, res) => {
        this.logger.warn('Tier hour limit exceeded', {
          userId,
          tier: userTierInfo.tier,
          limit: effectiveLimits.requestsPerHour
        });
      }
    }, req, res);

    if (!hourResult.allowed) {
      return this.createExceededResult(
        userTierInfo.tier,
        tierConfig,
        hourResult.retryAfter,
        'hour'
      );
    }

    // Check day limit
    const dayResult = await this.advancedLimiter.checkRateLimit(keys.day, {
      windowMs: 24 * 60 * 60 * 1000,
      max: effectiveLimits.requestsPerDay,
      onLimitReached: (req, res) => {
        this.logger.warn('Tier day limit exceeded', {
          userId,
          tier: userTierInfo.tier,
          limit: effectiveLimits.requestsPerDay
        });
      }
    }, req, res);

    if (!dayResult.allowed) {
      return this.createExceededResult(
        userTierInfo.tier,
        tierConfig,
        dayResult.retryAfter,
        'day'
      );
    }

    // Check month limit
    const monthResult = await this.advancedLimiter.checkRateLimit(keys.month, {
      windowMs: 30 * 24 * 60 * 60 * 1000,
      max: effectiveLimits.requestsPerMonth,
      onLimitReached: (req, res) => {
        this.logger.warn('Tier month limit exceeded', {
          userId,
          tier: userTierInfo.tier,
          limit: effectiveLimits.requestsPerMonth
        });
      }
    }, req, res);

    if (!monthResult.allowed) {
      return this.createExceededResult(
        userTierInfo.tier,
        tierConfig,
        monthResult.retryAfter,
        'month'
      );
    }

    // Get current usage statistics
    const [minuteStats, hourStats, dayStats, monthStats] = await Promise.all([
      this.advancedLimiter.getRateLimitStats(keys.minute),
      this.advancedLimiter.getRateLimitStats(keys.hour),
      this.advancedLimiter.getRateLimitStats(keys.day),
      this.advancedLimiter.getRateLimitStats(keys.month)
    ]);

    return {
      allowed: true,
      tier: userTierInfo.tier,
      limits: {
        minute: {
          used: minuteStats.currentHits,
          limit: effectiveLimits.requestsPerMinute,
          resetTime: minuteStats.resetTime
        },
        hour: {
          used: hourStats.currentHits,
          limit: effectiveLimits.requestsPerHour,
          resetTime: hourStats.resetTime
        },
        day: {
          used: dayStats.currentHits,
          limit: effectiveLimits.requestsPerDay,
          resetTime: dayStats.resetTime
        },
        month: {
          used: monthStats.currentHits,
          limit: effectiveLimits.requestsPerMonth,
          resetTime: monthStats.resetTime
        }
      },
      features: {
        burstRemaining: Math.max(0, tierConfig.features.burstAllowance - minuteStats.currentHits),
        priorityAccess: tierConfig.features.prioritySupport,
        customAccess: tierConfig.features.customEndpoints,
        analyticsAccess: tierConfig.features.advancedAnalytics
      }
    };
  }

  private calculateEffectiveLimits(userInfo: UserTierInfo, tierConfig: TierConfig): TierConfig['limits'] {
    let limits = { ...tierConfig.limits };

    // Apply special features multipliers
    if (userInfo.specialFeatures) {
      const burstMultiplier = userInfo.specialFeatures.burstMultiplier || 1;
      const priorityMultiplier = userInfo.specialFeatures.priorityMultiplier || 1;

      limits.requestsPerMinute = Math.floor(limits.requestsPerMinute * burstMultiplier * priorityMultiplier);
      limits.requestsPerHour = Math.floor(limits.requestsPerHour * priorityMultiplier);
      limits.requestsPerDay = Math.floor(limits.requestsPerDay * priorityMultiplier);
      limits.requestsPerMonth = Math.floor(limits.requestsPerMonth * priorityMultiplier);
    }

    return limits;
  }

  private createBypassResult(tier: UserTier, tierConfig: TierConfig): TieredRateLimitResult {
    const now = Date.now();
    return {
      allowed: true,
      tier,
      limits: {
        minute: { used: 0, limit: Infinity, resetTime: now + 60000 },
        hour: { used: 0, limit: Infinity, resetTime: now + 3600000 },
        day: { used: 0, limit: Infinity, resetTime: now + 86400000 },
        month: { used: 0, limit: Infinity, resetTime: now + 2592000000 }
      },
      features: {
        burstRemaining: Infinity,
        priorityAccess: true,
        customAccess: true,
        analyticsAccess: true
      }
    };
  }

  private createExceededResult(
    tier: UserTier,
    tierConfig: TierConfig,
    retryAfter?: number,
    limitType?: string
  ): TieredRateLimitResult {
    const now = Date.now();
    return {
      allowed: false,
      tier,
      limits: {
        minute: { used: 0, limit: tierConfig.limits.requestsPerMinute, resetTime: now + 60000 },
        hour: { used: 0, limit: tierConfig.limits.requestsPerHour, resetTime: now + 3600000 },
        day: { used: 0, limit: tierConfig.limits.requestsPerDay, resetTime: now + 86400000 },
        month: { used: 0, limit: tierConfig.limits.requestsPerMonth, resetTime: now + 2592000000 }
      },
      features: {
        burstRemaining: 0,
        priorityAccess: tierConfig.features.prioritySupport,
        customAccess: tierConfig.features.customEndpoints,
        analyticsAccess: tierConfig.features.advancedAnalytics
      },
      retryAfter
    };
  }

  async upgradeUserTier(userId: string, newTier: UserTier): Promise<void> {
    const currentInfo = this.getUserTier(userId) || { userId, tier: UserTier.FREE };
    
    // Reset existing rate limits when upgrading
    const keys = [
      `rate_limit:tiered:${userId}:minute`,
      `rate_limit:tiered:${userId}:hour`,
      `rate_limit:tiered:${userId}:day`,
      `rate_limit:tiered:${userId}:month`
    ];

    await Promise.all(keys.map(key => this.advancedLimiter.resetRateLimit(key)));

    currentInfo.tier = newTier;
    this.setUserTier(currentInfo);

    this.logger.info('User tier upgraded', { userId, from: currentInfo.tier, to: newTier });
  }

  async getTierAnalytics(tier: UserTier, timeRange: number = 3600000): Promise<{
    totalRequests: number;
    activeUsers: number;
    averageUsage: number;
    topEndpoints: Array<{ endpoint: string; requests: number }>;
  }> {
    // This would typically query analytics database
    // For now, return basic structure
    return {
      totalRequests: 0,
      activeUsers: 0,
      averageUsage: 0,
      topEndpoints: []
    };
  }

  getAllTierConfigs(): TierConfig[] {
    return Array.from(this.tierConfigs.values());
  }

  getAllUserTiers(): UserTierInfo[] {
    return Array.from(this.userTiers.values());
  }

  removeUserTier(userId: string): void {
    this.userTiers.delete(userId);
    this.logger.info('User tier removed', { userId });
  }

  public middleware(endpoint: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = (req as any).user;
        if (!user?.id) {
          return next(); // Skip rate limiting for unauthenticated requests
        }

        const result = await this.checkTieredRateLimit(user.id, endpoint, req, res);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': result.limits.minute.limit,
          'X-RateLimit-Remaining': (result.limits.minute.limit - result.limits.minute.used).toString(),
          'X-RateLimit-Reset': Math.ceil(result.limits.minute.resetTime / 1000).toString(),
          'X-RateLimit-Tier': result.tier,
          'X-RateLimit-Features': JSON.stringify(result.features),
          'X-RateLimit-Endpoint': endpoint
        });

        if (!result.allowed) {
          return res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded for ${result.tier} tier. Please try again later.`,
            retryAfter: result.retryAfter,
            tier: result.tier,
            endpoint,
            resetTime: new Date(result.limits.minute.resetTime),
            upgradeUrl: `/api/billing/upgrade?from=${result.tier}`
          });
        }

        next();
      } catch (error) {
        this.logger.error('Tiered rate limiter middleware error', { error, endpoint });
        next(); // Fail open
      }
    };
  }

  public async getTierUsageStats(): Promise<{ [tier in UserTier]: { users: number; requests: number } }> {
    const stats: { [tier in UserTier]: { users: number; requests: number } } = {
      [UserTier.FREE]: { users: 0, requests: 0 },
      [UserTier.BASIC]: { users: 0, requests: 0 },
      [UserTier.PREMIUM]: { users: 0, requests: 0 },
      [UserTier.ENTERPRISE]: { users: 0, requests: 0 },
      [UserTier.CUSTOM]: { users: 0, requests: 0 }
    };

    // Count users per tier
    for (const [userId, tierInfo] of this.userTiers.entries()) {
      stats[tierInfo.tier].users++;
      
      // Get current usage for this user
      const minuteKey = `rate_limit:tiered:${userId}:minute`;
      const minuteStats = await this.advancedLimiter.getRateLimitStats(minuteKey);
      stats[tierInfo.tier].requests += minuteStats.currentHits;
    }

    return stats;
  }

  public emitTierUpgradeEvent(userId: string, fromTier: UserTier, toTier: UserTier): void {
    this.emit('tier_upgrade', {
      userId,
      fromTier,
      toTier,
      timestamp: new Date()
    });
  }

  public emitTierViolationEvent(userId: string, tier: UserTier, endpoint: string): void {
    this.emit('tier_violation', {
      userId,
      tier,
      endpoint,
      timestamp: new Date()
    });
  }
}
