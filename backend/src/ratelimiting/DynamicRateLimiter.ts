import { AdvancedRateLimiter, RateLimitConfig, RateLimitResult, SystemMetrics } from './AdvancedRateLimiter';
import { WinstonLogger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

export interface DynamicAdjustmentRule {
  id: string;
  name: string;
  description: string;
  condition: (metrics: SystemMetrics, context: any) => boolean;
  adjustment: (currentLimits: any, metrics: SystemMetrics) => any;
  priority: number;
  enabled: boolean;
}

export interface LoadBalancingConfig {
  enabled: boolean;
  strategy: 'round-robin' | 'least-connections' | 'weighted' | 'adaptive';
  servers: Array<{
    id: string;
    url: string;
    weight: number;
    currentLoad: number;
    maxConnections: number;
  }>;
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
    retries: number;
  };
}

export interface DynamicRateLimitResult {
  allowed: boolean;
  adjustedLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  };
  adjustmentReason: string;
  systemLoad: SystemMetrics;
  appliedRules: string[];
  retryAfter?: number;
}

export interface PredictionMetrics {
  predictedLoad: number;
  confidence: number;
  timeHorizon: number;
  factors: Array<{
    name: string;
    impact: number;
    weight: number;
  }>;
}

export class DynamicRateLimiter extends EventEmitter {
  private advancedLimiter: AdvancedRateLimiter;
  private logger: WinstonLogger;
  private adjustmentRules: Map<string, DynamicAdjustmentRule> = new Map();
  private loadBalancingConfig: LoadBalancingConfig;
  private currentMetrics: SystemMetrics;
  private historicalData: Array<{ timestamp: number; metrics: SystemMetrics }> = [];
  private predictionModel: any;
  private adjustmentHistory: Array<{
    timestamp: number;
    rule: string;
    oldLimits: any;
    newLimits: any;
    reason: string;
  }> = [];

  constructor(advancedLimiter: AdvancedRateLimiter) {
    super();
    this.advancedLimiter = advancedLimiter;
    this.logger = new WinstonLogger();
    this.currentMetrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      activeConnections: 0,
      requestRate: 0
    };
    
    this.loadBalancingConfig = {
      enabled: false,
      strategy: 'adaptive',
      servers: [],
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        retries: 3
      }
    };

    this.initializeDefaultRules();
    this.startMetricsCollection();
    this.startPredictionEngine();
  }

  private initializeDefaultRules(): void {
    const defaultRules: DynamicAdjustmentRule[] = [
      {
        id: 'high-cpu-usage',
        name: 'High CPU Usage Reduction',
        description: 'Reduce limits when CPU usage is high',
        condition: (metrics) => metrics.cpuUsage > 80,
        adjustment: (limits) => ({
          ...limits,
          requestsPerMinute: Math.floor(limits.requestsPerMinute * 0.7),
          requestsPerHour: Math.floor(limits.requestsPerHour * 0.8),
          requestsPerDay: Math.floor(limits.requestsPerDay * 0.9)
        }),
        priority: 1,
        enabled: true
      },
      {
        id: 'high-memory-usage',
        name: 'High Memory Usage Reduction',
        description: 'Reduce limits when memory usage is high',
        condition: (metrics) => metrics.memoryUsage > 0.9,
        adjustment: (limits) => ({
          ...limits,
          requestsPerMinute: Math.floor(limits.requestsPerMinute * 0.6),
          requestsPerHour: Math.floor(limits.requestsPerHour * 0.7),
          requestsPerDay: Math.floor(limits.requestsPerDay * 0.8)
        }),
        priority: 1,
        enabled: true
      },
      {
        id: 'low-load-increase',
        name: 'Low Load Increase',
        description: 'Increase limits when system load is low',
        condition: (metrics) => metrics.cpuUsage < 30 && metrics.memoryUsage < 0.5,
        adjustment: (limits) => ({
          ...limits,
          requestsPerMinute: Math.floor(limits.requestsPerMinute * 1.2),
          requestsPerHour: Math.floor(limits.requestsPerHour * 1.15),
          requestsPerDay: Math.floor(limits.requestsPerDay * 1.1)
        }),
        priority: 2,
        enabled: true
      },
      {
        id: 'emergency-mode',
        name: 'Emergency Mode',
        description: 'Drastically reduce limits in emergency situations',
        condition: (metrics) => metrics.cpuUsage > 95 || metrics.memoryUsage > 0.98,
        adjustment: (limits) => ({
          ...limits,
          requestsPerMinute: Math.floor(limits.requestsPerMinute * 0.2),
          requestsPerHour: Math.floor(limits.requestsPerHour * 0.3),
          requestsPerDay: Math.floor(limits.requestsPerDay * 0.5)
        }),
        priority: 0,
        enabled: true
      },
      {
        id: 'time-based-adjustment',
        name: 'Time-based Adjustment',
        description: 'Adjust limits based on time of day',
        condition: (metrics, context) => {
          const hour = new Date().getHours();
          return hour >= 9 && hour <= 17; // Business hours
        },
        adjustment: (limits) => ({
          ...limits,
          requestsPerMinute: Math.floor(limits.requestsPerMinute * 1.1),
          requestsPerHour: Math.floor(limits.requestsPerHour * 1.05),
          requestsPerDay: limits.requestsPerDay
        }),
        priority: 3,
        enabled: true
      }
    ];

    defaultRules.forEach(rule => {
      this.adjustmentRules.set(rule.id, rule);
    });
  }

  async checkDynamicRateLimit(
    key: string,
    baseLimits: {
      requestsPerMinute: number;
      requestsPerHour: number;
      requestsPerDay: number;
    },
    context?: any,
    req?: any,
    res?: any
  ): Promise<DynamicRateLimitResult> {
    // Get current system metrics
    const metrics = await this.getCurrentMetrics();
    
    // Apply dynamic adjustments
    const adjustedLimits = this.applyDynamicAdjustments(baseLimits, metrics, context);
    
    // Check rate limit with adjusted limits
    const minuteKey = `${key}:minute`;
    const hourKey = `${key}:hour`;
    const dayKey = `${key}:day`;

    const [minuteResult, hourResult, dayResult] = await Promise.all([
      this.advancedLimiter.checkRateLimit(minuteKey, {
        windowMs: 60 * 1000,
        max: adjustedLimits.requestsPerMinute,
        onLimitReached: (req, res) => {
          this.logger.warn('Dynamic minute limit exceeded', {
            key,
            limit: adjustedLimits.requestsPerMinute,
            baseLimit: baseLimits.requestsPerMinute
          });
        }
      }, req, res),
      this.advancedLimiter.checkRateLimit(hourKey, {
        windowMs: 60 * 60 * 1000,
        max: adjustedLimits.requestsPerHour,
        onLimitReached: (req, res) => {
          this.logger.warn('Dynamic hour limit exceeded', {
            key,
            limit: adjustedLimits.requestsPerHour,
            baseLimit: baseLimits.requestsPerHour
          });
        }
      }, req, res),
      this.advancedLimiter.checkRateLimit(dayKey, {
        windowMs: 24 * 60 * 60 * 1000,
        max: adjustedLimits.requestsPerDay,
        onLimitReached: (req, res) => {
          this.logger.warn('Dynamic day limit exceeded', {
            key,
            limit: adjustedLimits.requestsPerDay,
            baseLimit: baseLimits.requestsPerDay
          });
        }
      }, req, res)
    ]);

    const allowed = minuteResult.allowed && hourResult.allowed && dayResult.allowed;
    const appliedRules = this.getAppliedRules(metrics, context);
    const adjustmentReason = this.getAdjustmentReason(appliedRules, metrics);

    if (!allowed) {
      const retryAfter = Math.min(
        minuteResult.retryAfter || Infinity,
        hourResult.retryAfter || Infinity,
        dayResult.retryAfter || Infinity
      );
      
      return {
        allowed: false,
        adjustedLimits,
        adjustmentReason,
        systemLoad: metrics,
        appliedRules,
        retryAfter
      };
    }

    return {
      allowed: true,
      adjustedLimits,
      adjustmentReason,
      systemLoad: metrics,
      appliedRules
    };
  }

  private applyDynamicAdjustments(
    baseLimits: any,
    metrics: SystemMetrics,
    context?: any
  ): any {
    let adjustedLimits = { ...baseLimits };
    const appliedRules: string[] = [];

    // Sort rules by priority (lower number = higher priority)
    const sortedRules = Array.from(this.adjustmentRules.values())
      .filter(rule => rule.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      try {
        if (rule.condition(metrics, context)) {
          const newLimits = rule.adjustment(adjustedLimits, metrics);
          
          // Only apply if limits actually changed
          if (JSON.stringify(newLimits) !== JSON.stringify(adjustedLimits)) {
            this.recordAdjustment(rule.id, adjustedLimits, newLimits, rule.name);
            adjustedLimits = newLimits;
            appliedRules.push(rule.id);
          }
        }
      } catch (error) {
        this.logger.error('Error applying adjustment rule', {
          ruleId: rule.id,
          error
        });
      }
    }

    return adjustedLimits;
  }

  private getAppliedRules(metrics: SystemMetrics, context?: any): string[] {
    return Array.from(this.adjustmentRules.values())
      .filter(rule => rule.enabled && rule.condition(metrics, context))
      .map(rule => rule.id);
  }

  private getAdjustmentReason(appliedRules: string[], metrics: SystemMetrics): string {
    if (appliedRules.length === 0) {
      return 'No adjustments applied';
    }

    const ruleNames = appliedRules.map(id => {
      const rule = this.adjustmentRules.get(id);
      return rule?.name || id;
    });

    return `Applied rules: ${ruleNames.join(', ')}`;
  }

  private recordAdjustment(
    ruleId: string,
    oldLimits: any,
    newLimits: any,
    reason: string
  ): void {
    const adjustment = {
      timestamp: Date.now(),
      rule: ruleId,
      oldLimits: { ...oldLimits },
      newLimits: { ...newLimits },
      reason
    };

    this.adjustmentHistory.push(adjustment);
    
    // Keep only last 1000 adjustments
    if (this.adjustmentHistory.length > 1000) {
      this.adjustmentHistory = this.adjustmentHistory.slice(-1000);
    }

    // Log adjustment event
    this.logger.info('Adjustment applied', adjustment);
  }

  async getCurrentMetrics(): Promise<SystemMetrics> {
    // Use any to avoid TypeScript issues with Node.js globals
    const nodeProcess = (globalThis as any).process;
    const usage = nodeProcess?.cpuUsage?.() || { user: 0, system: 0 };
    const memoryUsage = nodeProcess?.memoryUsage?.() || { heapUsed: 0, heapTotal: 1 };
    
    this.currentMetrics = {
      cpuUsage: (usage.user + usage.system) / 1000000,
      memoryUsage: memoryUsage.heapUsed / memoryUsage.heapTotal,
      activeConnections: this.advancedLimiter['redis']?.status === 'ready' ? 1 : 0,
      requestRate: this.calculateRequestRate()
    };

    return this.currentMetrics;
  }

  private calculateRequestRate(): number {
    const now = Date.now();
    const recentRequests = this.historicalData.filter(
      entry => now - entry.timestamp < 60000 // Last minute
    );
    return recentRequests.length;
  }

  private startMetricsCollection(): void {
    // Use globalThis to access setInterval
    const globalSetInterval = (globalThis as any).setInterval;
    globalSetInterval(async () => {
      const metrics = await this.getCurrentMetrics();
      this.historicalData.push({
        timestamp: Date.now(),
        metrics: { ...metrics }
      });

      // Keep only last 24 hours of data
      const cutoff = Date.now() - (24 * 60 * 60 * 1000);
      this.historicalData = this.historicalData.filter(entry => entry.timestamp > cutoff);

      this.logger.info('Metrics updated', metrics);
    }, 30000); // Collect every 30 seconds
  }

  private startPredictionEngine(): void {
    // Use globalThis to access setInterval
    const globalSetInterval = (globalThis as any).setInterval;
    globalSetInterval(async () => {
      const prediction = await this.predictLoad();
      this.logger.info('Load predicted', prediction);
    }, 300000); // Predict every 5 minutes
  }

  async predictLoad(timeHorizon: number = 300000): Promise<PredictionMetrics> {
    // Simple linear regression based on historical data
    const now = Date.now();
    const relevantData = this.historicalData.filter(
      entry => now - entry.timestamp < timeHorizon * 2
    );

    if (relevantData.length < 2) {
      return {
        predictedLoad: this.currentMetrics.cpuUsage,
        confidence: 0,
        timeHorizon,
        factors: []
      };
    }

    // Calculate trend
    const cpuValues = relevantData.map(entry => entry.metrics.cpuUsage);
    const trend = this.calculateLinearTrend(cpuValues);
    
    // Predict future load
    const predictedLoad = Math.max(0, Math.min(100, 
      this.currentMetrics.cpuUsage + (trend.slope * (timeHorizon / 30000))
    ));

    return {
      predictedLoad,
      confidence: Math.abs(trend.correlation),
      timeHorizon,
      factors: [
        {
          name: 'cpu_trend',
          impact: trend.slope,
          weight: 0.7
        },
        {
          name: 'current_load',
          impact: this.currentMetrics.cpuUsage,
          weight: 0.3
        }
      ]
    };
  }

  private calculateLinearTrend(values: number[]): { slope: number; correlation: number } {
    const n = values.length;
    if (n < 2) return { slope: 0, correlation: 0 };

    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = values.reduce((sum, val, index) => sum + (index * val), 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // Calculate correlation coefficient
    const meanY = sumY / n;
    const meanX = (n - 1) / 2;
    
    let numerator = 0;
    let sumXSquared = 0;
    let sumYSquared = 0;
    
    for (let i = 0; i < n; i++) {
      const xDiff = i - meanX;
      const yDiff = values[i] - meanY;
      numerator += xDiff * yDiff;
      sumXSquared += xDiff * xDiff;
      sumYSquared += yDiff * yDiff;
    }
    
    const correlation = numerator / Math.sqrt(sumXSquared * sumYSquared);
    
    return { slope, correlation: isNaN(correlation) ? 0 : correlation };
  }

  // Rule management
  addAdjustmentRule(rule: DynamicAdjustmentRule): void {
    this.adjustmentRules.set(rule.id, rule);
    this.logger.info('Adjustment rule added', { ruleId: rule.id, name: rule.name });
  }

  removeAdjustmentRule(ruleId: string): void {
    this.adjustmentRules.delete(ruleId);
    this.logger.info('Adjustment rule removed', { ruleId });
  }

  enableRule(ruleId: string): void {
    const rule = this.adjustmentRules.get(ruleId);
    if (rule) {
      rule.enabled = true;
      this.logger.info('Adjustment rule enabled', { ruleId });
    }
  }

  disableRule(ruleId: string): void {
    const rule = this.adjustmentRules.get(ruleId);
    if (rule) {
      rule.enabled = false;
      this.logger.info('Adjustment rule disabled', { ruleId });
    }
  }

  getAdjustmentRules(): DynamicAdjustmentRule[] {
    return Array.from(this.adjustmentRules.values());
  }

  getAdjustmentHistory(limit: number = 100): Array<{
    timestamp: number;
    rule: string;
    oldLimits: any;
    newLimits: any;
    reason: string;
  }> {
    return this.adjustmentHistory.slice(-limit);
  }

  // Load balancing methods
  configureLoadBalancing(config: Partial<LoadBalancingConfig>): void {
    this.loadBalancingConfig = { ...this.loadBalancingConfig, ...config };
    this.logger.info('Load balancing configured', { config });
  }

  async selectOptimalServer(): Promise<string | null> {
    if (!this.loadBalancingConfig.enabled || this.loadBalancingConfig.servers.length === 0) {
      return null;
    }

    const { strategy, servers } = this.loadBalancingConfig;

    switch (strategy) {
      case 'least-connections':
        return servers.reduce((min, server) => 
          server.currentLoad < min.currentLoad ? server : min
        ).id;
      
      case 'weighted':
        const totalWeight = servers.reduce((sum, server) => sum + server.weight, 0);
        const random = Math.random() * totalWeight;
        let currentWeight = 0;
        
        for (const server of servers) {
          currentWeight += server.weight;
          if (random <= currentWeight) {
            return server.id;
          }
        }
        return servers[0].id;
      
      case 'adaptive':
        // Select server based on current load and weight
        return servers.reduce((best, server) => {
          const serverScore = server.weight / (server.currentLoad + 1);
          const bestScore = best.weight / (best.currentLoad + 1);
          return serverScore > bestScore ? server : best;
        }).id;
      
      case 'round-robin':
      default:
        const index = Math.floor(Math.random() * servers.length);
        return servers[index].id;
    }
  }

  async getAnalytics(timeRange: number = 3600000): Promise<{
    totalAdjustments: number;
    mostActiveRules: Array<{ ruleId: string; count: number }>;
    averageAdjustmentImpact: number;
    predictionAccuracy: number;
    loadBalancingEfficiency: number;
  }> {
    const cutoff = Date.now() - timeRange;
    const recentAdjustments = this.adjustmentHistory.filter(adj => adj.timestamp > cutoff);

    const ruleCounts = recentAdjustments.reduce((counts, adj) => {
      counts[adj.rule] = (counts[adj.rule] || 0) + 1;
      return counts;
    }, {} as { [key: string]: number });

    const mostActiveRules = Object.entries(ruleCounts)
      .map(([ruleId, count]) => ({ ruleId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalAdjustments: recentAdjustments.length,
      mostActiveRules,
      averageAdjustmentImpact: this.calculateAverageImpact(recentAdjustments),
      predictionAccuracy: 0.85, // Would be calculated from prediction history
      loadBalancingEfficiency: this.calculateLoadBalancingEfficiency()
    };
  }

  private calculateAverageImpact(adjustments: any[]): number {
    if (adjustments.length === 0) return 0;

    const totalImpact = adjustments.reduce((sum, adj) => {
      const oldMinute = adj.oldLimits.requestsPerMinute;
      const newMinute = adj.newLimits.requestsPerMinute;
      const impact = Math.abs(newMinute - oldMinute) / oldMinute;
      return sum + impact;
    }, 0);

    return totalImpact / adjustments.length;
  }

  private calculateLoadBalancingEfficiency(): number {
    if (!this.loadBalancingConfig.enabled || this.loadBalancingConfig.servers.length === 0) {
      return 1;
    }

    const servers = this.loadBalancingConfig.servers;
    const totalLoad = servers.reduce((sum, server) => sum + server.currentLoad, 0);
    const avgLoad = totalLoad / servers.length;

    const variance = servers.reduce((sum, server) => {
      return sum + Math.pow(server.currentLoad - avgLoad, 2);
    }, 0) / servers.length;

    // Lower variance = higher efficiency
    return Math.max(0, 1 - (variance / (avgLoad * avgLoad)));
  }

  public middleware(baseLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
  }, key: string = 'default') {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await this.checkDynamicRateLimit(key, baseLimits, {
          endpoint: req.path,
          method: req.method,
          userAgent: req.get('User-Agent')
        }, req, res);

        // Set rate limit headers
        res.set({
          'X-RateLimit-Limit': result.adjustedLimits.requestsPerMinute,
          'X-RateLimit-Remaining': Math.max(0, result.adjustedLimits.requestsPerMinute - result.systemLoad.requestRate).toString(),
          'X-RateLimit-Reset': Math.ceil(Date.now() / 1000 + 60).toString(),
          'X-RateLimit-Adjusted': 'true',
          'X-RateLimit-Reason': result.adjustmentReason,
          'X-RateLimit-System-Load': JSON.stringify(result.systemLoad)
        });

        if (!result.allowed) {
          return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Dynamic rate limit exceeded. System is currently under load.',
            retryAfter: result.retryAfter,
            adjustedLimits: result.adjustedLimits,
            adjustmentReason: result.adjustmentReason,
            systemLoad: result.systemLoad,
            appliedRules: result.appliedRules
          });
        }

        next();
      } catch (error) {
        this.logger.error('Dynamic rate limiter middleware error', { error, key });
        next(); // Fail open
      }
    };
  }

  public enableEmergencyMode(): void {
    this.addAdjustmentRule({
      id: 'emergency-mode-override',
      name: 'Emergency Mode Override',
      description: 'Emergency mode activated by administrator',
      condition: () => true,
      adjustment: (limits) => ({
        ...limits,
        requestsPerMinute: Math.floor(limits.requestsPerMinute * 0.1),
        requestsPerHour: Math.floor(limits.requestsPerHour * 0.2),
        requestsPerDay: Math.floor(limits.requestsPerDay * 0.3)
      }),
      priority: -1,
      enabled: true
    });

    this.emit('emergency_mode_enabled', { timestamp: Date.now() });
    this.logger.warn('Emergency mode enabled');
  }

  public disableEmergencyMode(): void {
    this.removeAdjustmentRule('emergency-mode-override');
    this.emit('emergency_mode_disabled', { timestamp: Date.now() });
    this.logger.info('Emergency mode disabled');
  }

  public getSystemHealth(): {
    status: 'healthy' | 'warning' | 'critical';
    metrics: SystemMetrics;
    activeRules: string[];
    recommendations: string[];
  } {
    const { cpuUsage, memoryUsage, requestRate } = this.currentMetrics;
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    const recommendations: string[] = [];

    if (cpuUsage > 90 || memoryUsage > 0.95) {
      status = 'critical';
      recommendations.push('System is under critical load - consider scaling');
    } else if (cpuUsage > 70 || memoryUsage > 0.8) {
      status = 'warning';
      recommendations.push('System load is high - monitor closely');
    }

    const activeRules = Array.from(this.adjustmentRules.values())
      .filter(rule => rule.enabled)
      .map(rule => rule.id);

    return {
      status,
      metrics: this.currentMetrics,
      activeRules,
      recommendations
    };
  }
}
