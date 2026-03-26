import { Request, Response, NextFunction } from 'express';
import { AdvancedRateLimiter } from '../../ratelimiting/AdvancedRateLimiter';
import { UserRateLimiter, UserRateLimitConfig, UserRateLimitStatus } from '../../ratelimiting/UserRateLimiter';
import { TieredRateLimiter, UserTier, UserTierInfo, TierConfig } from '../../ratelimiting/TieredRateLimiter';
import { DynamicRateLimiter, DynamicAdjustmentRule, LoadBalancingConfig } from '../../ratelimiting/DynamicRateLimiter';
import { WinstonLogger } from '../../utils/logger';
import { EventEmitter } from 'events';

export interface RateLimitServiceConfig {
  redisUrl?: string;
  enableUserRateLimiting: boolean;
  enableTieredRateLimiting: boolean;
  enableDynamicAdjustment: boolean;
  defaultLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
}

export interface RateLimitCheckResult {
  allowed: boolean;
  userId?: string;
  tier?: UserTier;
  limits: {
    minute: { used: number; limit: number; resetTime: number };
    hour: { used: number; limit: number; resetTime: number };
    day: { used: number; limit: number; resetTime: number };
  };
  adjustmentReason?: string;
  retryAfter?: number;
  features?: {
    burstRemaining: number;
    priorityAccess: boolean;
    customAccess: boolean;
    analyticsAccess: boolean;
  };
}

export interface RateLimitAnalytics {
  totalRequests: number;
  blockedRequests: number;
  topUsers: Array<{
    userId: string;
    requests: number;
    tier?: UserTier;
  }>;
  topEndpoints: Array<{
    endpoint: string;
    requests: number;
  }>;
  systemLoad: {
    cpuUsage: number;
    memoryUsage: number;
    activeConnections: number;
    requestRate: number;
  };
  tierBreakdown: {
    [tier in UserTier]: {
      users: number;
      requests: number;
      blockedRequests: number;
    };
  };
}

export interface RateLimitNotification {
  type: 'limit_exceeded' | 'tier_upgrade' | 'emergency_mode' | 'system_load';
  userId?: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  data?: any;
  timestamp: number;
}

export class RateLimitService extends EventEmitter {
  private advancedLimiter: AdvancedRateLimiter;
  private userRateLimiter: UserRateLimiter;
  private tieredRateLimiter: TieredRateLimiter;
  private dynamicRateLimiter: DynamicRateLimiter;
  private logger: WinstonLogger;
  private config: RateLimitServiceConfig;
  private notifications: RateLimitNotification[] = [];
  private emergencyMode: boolean = false;

  constructor(config: RateLimitServiceConfig) {
    super();
    this.config = config;
    this.logger = new WinstonLogger();
    
    // Initialize rate limiters
    this.advancedLimiter = new AdvancedRateLimiter(config.redisUrl);
    this.userRateLimiter = new UserRateLimiter(this.advancedLimiter);
    this.tieredRateLimiter = new TieredRateLimiter(this.advancedLimiter);
    this.dynamicRateLimiter = new DynamicRateLimiter(this.advancedLimiter);

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Note: AdvancedRateLimiter no longer extends EventEmitter
    // Event handling would need to be implemented differently
    // For now, we'll log important events directly
    
    this.logger.info('Rate limit service event handlers initialized');
  }

  async checkRateLimit(
    userId: string | undefined,
    endpoint: string,
    req?: any,
    res?: any
  ): Promise<RateLimitCheckResult> {
    try {
      // If emergency mode is enabled, allow all requests
      if (this.emergencyMode) {
        this.addNotification({
          type: 'emergency_mode',
          userId,
          message: 'Request allowed due to emergency mode',
          severity: 'high',
          timestamp: Date.now()
        });

        return {
          allowed: true,
          userId,
          limits: {
            minute: { used: 0, limit: Infinity, resetTime: Date.now() + 60000 },
            hour: { used: 0, limit: Infinity, resetTime: Date.now() + 3600000 },
            day: { used: 0, limit: Infinity, resetTime: Date.now() + 86400000 }
          }
        };
      }

      // If no userId, use IP-based rate limiting
      if (!userId) {
        const ip = req?.ip || req?.connection?.remoteAddress || 'unknown';
        return this.checkIpBasedRateLimit(ip, endpoint, req, res);
      }

      // Check tiered rate limiting first (if enabled)
      if (this.config.enableTieredRateLimiting) {
        const tierResult = await this.tieredRateLimiter.checkTieredRateLimit(
          userId,
          endpoint,
          req,
          res
        );

        if (!tierResult.allowed) {
          this.addNotification({
            type: 'limit_exceeded',
            userId,
            message: `Tier rate limit exceeded for ${endpoint}`,
            severity: 'medium',
            data: { tier: tierResult.tier, endpoint },
            timestamp: Date.now()
          });

          return {
            allowed: false,
            userId,
            tier: tierResult.tier,
            limits: tierResult.limits,
            retryAfter: tierResult.retryAfter,
            features: tierResult.features
          };
        }

        return {
          allowed: true,
          userId,
          tier: tierResult.tier,
          limits: tierResult.limits,
          features: tierResult.features
        };
      }

      // Check user-based rate limiting (if enabled)
      if (this.config.enableUserRateLimiting) {
        const userResult = await this.userRateLimiter.checkUserRateLimit(
          userId,
          endpoint,
          req,
          res
        );

        if (!userResult.allowed) {
          this.addNotification({
            type: 'limit_exceeded',
            userId,
            message: `User rate limit exceeded for ${endpoint}`,
            severity: 'medium',
            data: { endpoint },
            timestamp: Date.now()
          });

          return {
            allowed: false,
            userId,
            limits: {
              minute: {
                used: userResult.status.currentUsage.minute.used,
                limit: userResult.status.currentUsage.minute.limit,
                resetTime: userResult.status.currentUsage.minute.resetTime
              },
              hour: {
                used: userResult.status.currentUsage.hour.used,
                limit: userResult.status.currentUsage.hour.limit,
                resetTime: userResult.status.currentUsage.hour.resetTime
              },
              day: {
                used: userResult.status.currentUsage.day.used,
                limit: userResult.status.currentUsage.day.limit,
                resetTime: userResult.status.currentUsage.day.resetTime
              }
            },
            retryAfter: userResult.retryAfter
          };
        }

        return {
          allowed: true,
          userId,
          limits: {
            minute: {
              used: userResult.status.currentUsage.minute.used,
              limit: userResult.status.currentUsage.minute.limit,
              resetTime: userResult.status.currentUsage.minute.resetTime
            },
            hour: {
              used: userResult.status.currentUsage.hour.used,
              limit: userResult.status.currentUsage.hour.limit,
              resetTime: userResult.status.currentUsage.hour.resetTime
            },
            day: {
              used: userResult.status.currentUsage.day.used,
              limit: userResult.status.currentUsage.day.limit,
              resetTime: userResult.status.currentUsage.day.resetTime
            }
          }
        };
      }

      // Default to basic rate limiting
      return this.checkBasicRateLimit(userId, endpoint, req, res);

    } catch (error) {
      this.logger.error('Rate limit check failed', { userId, endpoint, error });
      
      // Fail open - allow request if rate limiting fails
      return {
        allowed: true,
        userId,
        limits: {
          minute: { used: 0, limit: this.config.defaultLimits.requestsPerMinute, resetTime: Date.now() + 60000 },
          hour: { used: 0, limit: this.config.defaultLimits.requestsPerHour, resetTime: Date.now() + 3600000 },
          day: { used: 0, limit: this.config.defaultLimits.requestsPerDay, resetTime: Date.now() + 86400000 }
        }
      };
    }
  }

  private async checkIpBasedRateLimit(
    ip: string,
    endpoint: string,
    req?: any,
    res?: any
  ): Promise<RateLimitCheckResult> {
    const key = `rate_limit:ip:${ip}`;
    
    // Apply dynamic adjustment if enabled
    let limits = this.config.defaultLimits;
    if (this.config.enableDynamicAdjustment) {
      const dynamicResult = await this.dynamicRateLimiter.checkDynamicRateLimit(
        key,
        limits,
        { ip, endpoint },
        req,
        res
      );

      return {
        allowed: dynamicResult.allowed,
        limits: {
          minute: { used: 0, limit: dynamicResult.adjustedLimits.requestsPerMinute, resetTime: Date.now() + 60000 },
          hour: { used: 0, limit: dynamicResult.adjustedLimits.requestsPerHour, resetTime: Date.now() + 3600000 },
          day: { used: 0, limit: dynamicResult.adjustedLimits.requestsPerDay, resetTime: Date.now() + 86400000 }
        },
        adjustmentReason: dynamicResult.adjustmentReason,
        retryAfter: dynamicResult.retryAfter
      };
    }

    // Basic rate limiting
    const result = await this.advancedLimiter.checkRateLimit(key, {
      windowMs: 60 * 1000,
      max: limits.requestsPerMinute,
      onLimitReached: (req, res) => {
        this.logger.warn('IP rate limit exceeded', { ip, endpoint });
      }
    }, req, res);

    return {
      allowed: result.allowed,
      limits: {
        minute: { used: result.totalHits, limit: limits.requestsPerMinute, resetTime: result.resetTime },
        hour: { used: 0, limit: limits.requestsPerHour, resetTime: Date.now() + 3600000 },
        day: { used: 0, limit: limits.requestsPerDay, resetTime: Date.now() + 86400000 }
      },
      retryAfter: result.retryAfter
    };
  }

  private async checkBasicRateLimit(
    userId: string,
    endpoint: string,
    req?: any,
    res?: any
  ): Promise<RateLimitCheckResult> {
    const key = `rate_limit:basic:${userId}`;
    const limits = this.config.defaultLimits;

    const result = await this.advancedLimiter.checkRateLimit(key, {
      windowMs: 60 * 1000,
      max: limits.requestsPerMinute,
      onLimitReached: (req, res) => {
        this.logger.warn('Basic rate limit exceeded', { userId, endpoint });
      }
    }, req, res);

    return {
      allowed: result.allowed,
      userId,
      limits: {
        minute: { used: result.totalHits, limit: limits.requestsPerMinute, resetTime: result.resetTime },
        hour: { used: 0, limit: limits.requestsPerHour, resetTime: Date.now() + 3600000 },
        day: { used: 0, limit: limits.requestsPerDay, resetTime: Date.now() + 86400000 }
      },
      retryAfter: result.retryAfter
    };
  }

  // User management methods
  setUserRateLimitConfig(config: UserRateLimitConfig): void {
    this.userRateLimiter.setUserConfig(config);
    this.logger.info('User rate limit config set', { userId: config.userId });
  }

  setUserTier(userInfo: UserTierInfo): void {
    this.tieredRateLimiter.setUserTier(userInfo);
    
    this.addNotification({
      type: 'tier_upgrade',
      userId: userInfo.userId,
      message: `User tier set to ${userInfo.tier}`,
      severity: 'low',
      data: { tier: userInfo.tier },
      timestamp: Date.now()
    });
  }

  async getUserRateLimitStatus(userId: string): Promise<UserRateLimitStatus | null> {
    return this.userRateLimiter.getUserRateLimitStatus(userId);
  }

  async upgradeUserTier(userId: string, newTier: UserTier): Promise<void> {
    await this.tieredRateLimiter.upgradeUserTier(userId, newTier);
    
    this.addNotification({
      type: 'tier_upgrade',
      userId,
      message: `User upgraded to ${newTier} tier`,
      severity: 'medium',
      data: { newTier },
      timestamp: Date.now()
    });
  }

  // Dynamic adjustment methods
  addAdjustmentRule(rule: DynamicAdjustmentRule): void {
    this.dynamicRateLimiter.addAdjustmentRule(rule);
    this.logger.info('Adjustment rule added', { ruleId: rule.id });
  }

  removeAdjustmentRule(ruleId: string): void {
    this.dynamicRateLimiter.removeAdjustmentRule(ruleId);
    this.logger.info('Adjustment rule removed', { ruleId });
  }

  setEmergencyMode(enabled: boolean): void {
    this.advancedLimiter.setEmergencyMode(enabled);
    this.emergencyMode = enabled;
  }

  // Analytics methods
  async getAnalytics(timeRange: number = 3600000): Promise<RateLimitAnalytics> {
    const [advancedAnalytics, userAnalytics, tierAnalytics] = await Promise.all([
      this.advancedLimiter.getAnalytics(timeRange),
      this.getUserAnalytics(timeRange),
      this.getTierAnalytics(timeRange)
    ]);

    return {
      totalRequests: advancedAnalytics.totalRequests,
      blockedRequests: advancedAnalytics.blockedRequests,
      topUsers: advancedAnalytics.topUsers.map(user => ({
        userId: user.key,
        requests: user.requests
      })),
      topEndpoints: [], // Would be populated from endpoint tracking
      systemLoad: advancedAnalytics.systemLoad,
      tierBreakdown: tierAnalytics
    };
  }

  private async getUserAnalytics(timeRange: number): Promise<any> {
    // Implementation for user-specific analytics
    return {};
  }

  private async getTierAnalytics(timeRange: number): Promise<{ [tier in UserTier]: { users: number; requests: number; blockedRequests: number } }> {
    const allTiers = [UserTier.FREE, UserTier.BASIC, UserTier.PREMIUM, UserTier.ENTERPRISE, UserTier.CUSTOM];
    const tierBreakdown: any = {};

    for (const tier of allTiers) {
      const analytics = await this.tieredRateLimiter.getTierAnalytics(tier, timeRange);
      tierBreakdown[tier] = {
        users: analytics.activeUsers,
        requests: analytics.totalRequests,
        blockedRequests: 0 // Would be calculated from blocked requests
      };
    }

    return tierBreakdown;
  }

  // Notification methods
  getNotifications(limit: number = 50): RateLimitNotification[] {
    return this.notifications.slice(-limit);
  }

  clearNotifications(): void {
    this.notifications = [];
  }

  private addNotification(notification: RateLimitNotification): void {
    this.notifications.push(notification);
    
    // Keep only last 1000 notifications
    if (this.notifications.length > 1000) {
      this.notifications = this.notifications.slice(-1000);
    }

    this.logger.info('Rate limit notification', notification);
  }

  // Configuration methods
  updateConfig(newConfig: Partial<RateLimitServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Rate limit service config updated', { config: newConfig });
  }

  getConfig(): RateLimitServiceConfig {
    return { ...this.config };
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: {
      redis: boolean;
      emergencyMode: boolean;
      totalUsers: number;
      activeRules: number;
    };
  }> {
    try {
      // Check Redis connection
      const redisStatus = this.advancedLimiter['redis']?.status === 'ready';
      
      // Get basic stats
      const totalUsers = this.userRateLimiter.getAllUserConfigs().length;
      const activeRules = this.dynamicRateLimiter.getAdjustmentRules().filter(rule => rule.enabled).length;

      const status = redisStatus ? 'healthy' : 'degraded';

      return {
        status,
        details: {
          redis: redisStatus,
          emergencyMode: this.emergencyMode,
          totalUsers,
          activeRules
        }
      };
    } catch (error) {
      this.logger.error('Health check failed', { error });
      return {
        status: 'unhealthy',
        details: {
          redis: false,
          emergencyMode: this.emergencyMode,
          totalUsers: 0,
          activeRules: 0
        }
      };
    }
  }

  // Cleanup
  async cleanup(): Promise<void> {
    await this.advancedLimiter.cleanup();
    this.logger.info('Rate limit service cleaned up');
  }

  // Middleware factory methods
  public createMiddleware(options: {
    endpoint?: string;
    enableUserRateLimiting?: boolean;
    enableTieredRateLimiting?: boolean;
    enableDynamicAdjustment?: boolean;
  } = {}) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const user = (req as any).user;
        const userId = user?.id;
        const endpoint = options.endpoint || req.path;

        const result = await this.checkRateLimit(userId, endpoint, req, res);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': result.limits.minute.limit,
          'X-RateLimit-Remaining': Math.max(0, result.limits.minute.limit - result.limits.minute.used).toString(),
          'X-RateLimit-Reset': Math.ceil(result.limits.minute.resetTime / 1000).toString(),
          'X-RateLimit-Type': result.tier ? 'tiered' : 'basic'
        });

        if (result.tier) {
          res.set('X-RateLimit-Tier', result.tier);
        }

        if (result.adjustmentReason) {
          res.set('X-RateLimit-Adjustment-Reason', result.adjustmentReason);
        }

        if (!result.allowed) {
          return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: result.retryAfter,
            limit: result.limits.minute.limit,
            resetTime: new Date(result.limits.minute.resetTime),
            tier: result.tier
          });
        }

        next();
      } catch (error) {
        this.logger.error('Rate limit middleware error', { error });
        next(); // Fail open
      }
    };
  }

  // API methods for external consumption
  public async getRateLimitStatus(userId?: string): Promise<any> {
    if (!userId) {
      return { error: 'User ID required' };
    }

    const userStatus = await this.getUserRateLimitStatus(userId);
    const tierInfo = this.tieredRateLimiter.getUserTier(userId);
    
    return {
      userId,
      userStatus,
      tier: tierInfo?.tier,
      emergencyMode: this.emergencyMode
    };
  }

  public async setRateLimits(userId: string, limits: {
    requestsPerMinute?: number;
    requestsPerHour?: number;
    requestsPerDay?: number;
  }): Promise<void> {
    const config: UserRateLimitConfig = {
      userId,
      tier: UserTier.CUSTOM,
      baseLimits: {
        requestsPerMinute: limits.requestsPerMinute || this.config.defaultLimits.requestsPerMinute,
        requestsPerHour: limits.requestsPerHour || this.config.defaultLimits.requestsPerHour,
        requestsPerDay: limits.requestsPerDay || this.config.defaultLimits.requestsPerDay,
        requestsPerMonth: this.config.defaultLimits.requestsPerDay * 30
      }
    };

    this.setUserRateLimitConfig(config);
  }

  public async getSystemMetrics(): Promise<any> {
    return {
      health: await this.healthCheck(),
      analytics: await this.getAnalytics(),
      notifications: this.getNotifications(),
      config: this.getConfig()
    };
  }

  public async createRateLimitAlert(type: RateLimitNotification['type'], data: any): Promise<void> {
    this.addNotification({
      type,
      userId: data.userId,
      message: data.message || `Rate limit ${type} triggered`,
      severity: data.severity || 'medium',
      data,
      timestamp: Date.now()
    });
  }
}
