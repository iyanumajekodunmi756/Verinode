import { AdvancedRateLimiter, RateLimitConfig, RateLimitResult } from './AdvancedRateLimiter';
import { WinstonLogger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';

export interface UserRateLimitConfig {
  userId: string;
  tier: 'free' | 'basic' | 'premium' | 'enterprise' | 'custom';
  baseLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    requestsPerMonth: number;
  };
  customLimits?: {
    [endpoint: string]: {
      requestsPerMinute: number;
      requestsPerHour: number;
      requestsPerDay: number;
      requestsPerMonth: number;
    };
  };
  specialFeatures?: {
    burstMultiplier: number;
    priorityMultiplier: number;
    bypassLimits: boolean;
    whitelist: boolean;
  };
  subscription?: {
    planId: string;
    status: 'active' | 'inactive' | 'cancelled' | 'expired';
    startDate: Date;
    endDate: Date;
    autoRenew: boolean;
  };
}

export interface UserRateLimitStatus {
  userId: string;
  currentUsage: {
    minute: { used: number; limit: number; resetTime: number };
    hour: { used: number; limit: number; resetTime: number };
    day: { used: number; limit: number; resetTime: number };
  };
  endpointUsage?: { [endpoint: string]: { used: number; limit: number; resetTime: number } };
  customLimitsActive: boolean;
  whitelist?: boolean;
  bypassLimits?: boolean;
}

export class UserRateLimiter {
  private advancedLimiter: AdvancedRateLimiter;
  private logger: WinstonLogger;
  private userConfigs: Map<string, UserRateLimitConfig> = new Map();

  constructor(advancedLimiter: AdvancedRateLimiter) {
    this.advancedLimiter = advancedLimiter;
    this.logger = new WinstonLogger();
  }

  setUserConfig(config: UserRateLimitConfig): void {
    this.userConfigs.set(config.userId, config);
    this.logger.info('User rate limit config updated', { userId: config.userId });
  }

  getUserConfig(userId: string): UserRateLimitConfig | undefined {
    return this.userConfigs.get(userId);
  }

  async checkUserRateLimit(
    userId: string,
    endpoint: string,
    req?: any,
    res?: any
  ): Promise<{ allowed: boolean; status: UserRateLimitStatus; retryAfter?: number }> {
    const config = this.getUserConfig(userId);
    
    // Default config if none exists
    const defaultConfig: UserRateLimitConfig = {
      userId,
      tier: 'free',
      baseLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000
      }
    };
    
    const userConfig = config || defaultConfig;
    
    // Check whitelist and bypass
    if (userConfig.specialFeatures?.whitelist || userConfig.specialFeatures?.bypassLimits) {
      const status = await this.createStatus(userId, userConfig, true);
      return {
        allowed: true,
        status
      };
    }

    // Check rate limits for different time windows
    const minuteKey = `rate_limit:user:${userId}:minute`;
    const hourKey = `rate_limit:user:${userId}:hour`;
    const dayKey = `rate_limit:user:${userId}:day`;
    
    // Check endpoint-specific limits if configured
    const endpointConfig = userConfig.customLimits?.[endpoint];
    let endpointResult: RateLimitResult | undefined;
    
    if (endpointConfig) {
      const endpointKey = `rate_limit:user:${userId}:endpoint:${endpoint}`;
      endpointResult = await this.advancedLimiter.checkRateLimit(endpointKey, {
        windowMs: 60 * 1000, // 1 minute
        max: endpointConfig.requestsPerMinute,
        onLimitReached: (req, res) => {
          this.logger.warn('User endpoint rate limit exceeded', {
            userId,
            endpoint,
            limit: endpointConfig.requestsPerMinute
          });
        }
      }, req, res);
      
      if (!endpointResult.allowed) {
        const status = await this.createStatus(userId, userConfig, false);
        status.endpointUsage = {
          [endpoint]: {
            used: endpointResult.totalHits,
            limit: endpointConfig.requestsPerMinute,
            resetTime: endpointResult.resetTime
          }
        };
        
        return {
          allowed: false,
          status,
          retryAfter: endpointResult.retryAfter
        };
      }
    }

    // Check minute limit
    const minuteResult = await this.advancedLimiter.checkRateLimit(minuteKey, {
      windowMs: 60 * 1000,
      max: userConfig.baseLimits.requestsPerMinute,
      onLimitReached: (req, res) => {
        this.logger.warn('User minute rate limit exceeded', {
          userId,
          limit: userConfig.baseLimits.requestsPerMinute
        });
      }
    }, req, res);

    if (!minuteResult.allowed) {
      const status = await this.createStatus(userId, userConfig, false, {
        minute: { used: minuteResult.totalHits, resetTime: minuteResult.resetTime }
      });
      return {
        allowed: false,
        status,
        retryAfter: minuteResult.retryAfter
      };
    }

    // Check hour limit
    const hourResult = await this.advancedLimiter.checkRateLimit(hourKey, {
      windowMs: 60 * 60 * 1000,
      max: userConfig.baseLimits.requestsPerHour,
      onLimitReached: (req, res) => {
        this.logger.warn('User hour rate limit exceeded', {
          userId,
          limit: userConfig.baseLimits.requestsPerHour
        });
      }
    }, req, res);

    if (!hourResult.allowed) {
      const status = await this.createStatus(userId, userConfig, false, {
        hour: { used: hourResult.totalHits, resetTime: hourResult.resetTime }
      });
      return {
        allowed: false,
        status,
        retryAfter: hourResult.retryAfter
      };
    }

    // Check day limit
    const dayResult = await this.advancedLimiter.checkRateLimit(dayKey, {
      windowMs: 24 * 60 * 60 * 1000,
      max: userConfig.baseLimits.requestsPerDay,
      onLimitReached: (req, res) => {
        this.logger.warn('User day rate limit exceeded', {
          userId,
          limit: userConfig.baseLimits.requestsPerDay
        });
      }
    }, req, res);

    if (!dayResult.allowed) {
      const status = await this.createStatus(userId, userConfig, false, {
        day: { used: dayResult.totalHits, resetTime: dayResult.resetTime }
      });
      return {
        allowed: false,
        status,
        retryAfter: dayResult.retryAfter
      };
    }

    const status = await this.createStatus(userId, userConfig, true);
    return {
      allowed: true,
      status
    };
  }

  async getUserRateLimitStatus(userId: string): Promise<UserRateLimitStatus> {
    const config = this.getUserConfig(userId) || {
      userId,
      tier: 'free',
      baseLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000
      }
    };

    return this.createStatus(userId, config, false);
  }

  private async createStatus(
    userId: string,
    config: UserRateLimitConfig,
    allowed: boolean,
    overrides?: {
      minute?: { used: number; resetTime: number };
      hour?: { used: number; resetTime: number };
      day?: { used: number; resetTime: number };
    }
  ): Promise<UserRateLimitStatus> {
    const now = Date.now();
    
    const minuteKey = `rate_limit:user:${userId}:minute`;
    const hourKey = `rate_limit:user:${userId}:hour`;
    const dayKey = `rate_limit:user:${userId}:day`;

    const [minuteStats, hourStats, dayStats] = await Promise.all([
      this.advancedLimiter.getRateLimitStats(minuteKey),
      this.advancedLimiter.getRateLimitStats(hourKey),
      this.advancedLimiter.getRateLimitStats(dayKey)
    ]);

    return {
      userId,
      currentUsage: {
        minute: {
          used: overrides?.minute?.used || minuteStats.currentHits,
          limit: config.baseLimits.requestsPerMinute,
          resetTime: overrides?.minute?.resetTime || minuteStats.resetTime
        },
        hour: {
          used: overrides?.hour?.used || hourStats.currentHits,
          limit: config.baseLimits.requestsPerHour,
          resetTime: overrides?.hour?.resetTime || hourStats.resetTime
        },
        day: {
          used: overrides?.day?.used || dayStats.currentHits,
          limit: config.baseLimits.requestsPerDay,
          resetTime: overrides?.day?.resetTime || dayStats.resetTime
        }
      },
      customLimitsActive: !!(config.customLimits && Object.keys(config.customLimits).length > 0),
      whitelist: config.specialFeatures?.whitelist || false,
      bypassLimits: config.specialFeatures?.bypassLimits || false
    } as UserRateLimitStatus;
  }

  async resetUserRateLimit(userId: string): Promise<void> {
    const keys = [
      `rate_limit:user:${userId}:minute`,
      `rate_limit:user:${userId}:hour`,
      `rate_limit:user:${userId}:day`
    ];

    // Also reset endpoint-specific limits
    const config = this.getUserConfig(userId);
    if (config?.customLimits) {
      for (const endpoint of Object.keys(config.customLimits)) {
        keys.push(`rate_limit:user:${userId}:endpoint:${endpoint}`);
      }
    }

    await Promise.all(keys.map(key => this.advancedLimiter.resetRateLimit(key)));
    
    this.logger.info('User rate limits reset', { userId });
  }

  async getUserAnalytics(userId: string, timeRange: number = 3600000): Promise<{
    totalRequests: number;
    endpointBreakdown: { [endpoint: string]: number };
    timeSeriesData: Array<{ timestamp: number; requests: number }>;
  }> {
    // This would typically query a time-series database or analytics system
    // For now, we'll provide a basic implementation
    
    try {
      const minuteKey = `rate_limit:user:${userId}:minute`;
      const stats = await this.advancedLimiter.getRateLimitStats(minuteKey);
      
      return {
        totalRequests: stats.currentHits,
        endpointBreakdown: {}, // Would be populated from analytics
        timeSeriesData: [] // Would be populated from analytics
      };
    } catch (error) {
      this.logger.error('Failed to get user analytics', { userId, error });
      return {
        totalRequests: 0,
        endpointBreakdown: {},
        timeSeriesData: []
      };
    }
  }

  async getTopUsers(limit: number = 10): Promise<Array<{
    userId: string;
    totalRequests: number;
    tier: string;
  }>> {
    // This would typically query a database for top users
    // For now, return empty array
    return [];
  }

  removeUserConfig(userId: string): void {
    this.userConfigs.delete(userId);
    this.logger.info('User rate limit config removed', { userId });
  }

  getAllUserConfigs(): UserRateLimitConfig[] {
    return Array.from(this.userConfigs.values());
  }

  public middleware(endpoint: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = (req as any).user;
        if (!user?.id) {
          return next(); // Skip rate limiting for unauthenticated requests
        }

        const result = await this.checkUserRateLimit(user.id, endpoint, req, res);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': result.status.currentUsage.minute.limit,
          'X-RateLimit-Remaining': (result.status.currentUsage.minute.limit - result.status.currentUsage.minute.used).toString(),
          'X-RateLimit-Reset': Math.ceil(result.status.currentUsage.minute.resetTime / 1000).toString(),
          'X-RateLimit-User-Tier': this.getUserConfig(user.id)?.tier || 'free',
          'X-RateLimit-User-ID': user.id,
          'X-RateLimit-Endpoint': endpoint
        });

        if (!result.allowed) {
          return res.status(429).json({
            error: 'Too Many Requests',
            message: `Rate limit exceeded for user. Please try again later.`,
            retryAfter: result.retryAfter,
            userId: user.id,
            endpoint,
            resetTime: new Date(result.status.currentUsage.minute.resetTime)
          });
        }

        next();
      } catch (error) {
        this.logger.error('User rate limiter middleware error', { error, endpoint });
        next(); // Fail open
      }
    };
  }

  public async upgradeUserTier(userId: string, newTier: UserRateLimitConfig['tier']): Promise<void> {
    const userConfig = this.getUserConfig(userId);
    if (!userConfig) {
      throw new Error(`User config not found for userId: ${userId}`);
    }

    const oldTier = userConfig.tier;
    userConfig.tier = newTier;
    this.setUserConfig(userConfig);

    this.logger.info('User tier upgraded', { userId, oldTier, newTier });
  }

  public async setCustomLimits(
    userId: string,
    limits: UserRateLimitConfig['customLimits']
  ): Promise<void> {
    const userConfig = this.getUserConfig(userId) || {
      userId,
      tier: 'free',
      baseLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000
      }
    };
    userConfig.customLimits = limits;
    this.setUserConfig(userConfig);
  }

  public async setUserSpecialFeatures(
    userId: string,
    features: Partial<UserRateLimitConfig['specialFeatures']>
  ): Promise<void> {
    const userConfig = this.getUserConfig(userId) || {
      userId,
      tier: 'free',
      baseLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        requestsPerMonth: 100000
      }
    };
    userConfig.specialFeatures = {
      burstMultiplier: 1,
      priorityMultiplier: 1,
      bypassLimits: false,
      whitelist: false,
      ...userConfig.specialFeatures,
      ...features
    };
    this.setUserConfig(userConfig);
  }
}
