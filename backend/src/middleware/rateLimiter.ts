import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { RateLimitService } from '../services/ratelimiting/RateLimitService';
import { UserTier } from '../ratelimiting/TieredRateLimiter';

/**
 * Enhanced Rate limiting configuration for different endpoints
 * Integrates with the advanced rate limiting service
 */

// Global rate limit service instance
let rateLimitService: RateLimitService | null = null;

// Initialize the rate limit service
export const initializeRateLimitService = (service: RateLimitService) => {
  rateLimitService = service;
};

// Enhanced rate limiter with service integration
const createEnhancedLimiter = (options: {
  windowMs?: number;
  max?: number;
  endpoint?: string;
  enableUserRateLimiting?: boolean;
  enableTieredRateLimiting?: boolean;
  enableDynamicAdjustment?: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // If rate limit service is available, use it
    if (rateLimitService) {
      try {
        const user = (req as any).user;
        const userId = user?.id;
        
        const result = await rateLimitService.checkRateLimit(userId, options.endpoint || req.path, req, res);
        
        // Set comprehensive rate limit headers
        res.set({
          'X-RateLimit-Limit': result.limits.minute.limit,
          'X-RateLimit-Remaining': Math.max(0, result.limits.minute.limit - result.limits.minute.used).toString(),
          'X-RateLimit-Reset': Math.ceil(result.limits.minute.resetTime / 1000).toString(),
          'X-RateLimit-Window': '60000', // 1 minute window
          'X-RateLimit-Service': 'enhanced'
        });

        if (result.tier) {
          res.set('X-RateLimit-Tier', result.tier);
        }

        if (result.adjustmentReason) {
          res.set('X-RateLimit-Adjustment-Reason', result.adjustmentReason);
        }

        if (result.features) {
          res.set('X-RateLimit-Features', JSON.stringify(result.features));
        }

        if (!result.allowed) {
          const statusCode = getStatusCodeForViolation(result);
          return res.status(statusCode).json({
            error: 'Too Many Requests',
            message: getErrorMessageForViolation(result, options.endpoint || req.path),
            retryAfter: result.retryAfter,
            limit: result.limits.minute.limit,
            windowMs: 60000,
            resetTime: new Date(result.limits.minute.resetTime),
            tier: result.tier,
            upgradeUrl: result.tier ? `/api/billing/upgrade?from=${result.tier}` : undefined,
            violationType: getViolationType(result)
          });
        }

        return next();
      } catch (error) {
        console.error('Enhanced rate limiter error:', error);
        // Fall back to basic rate limiting
      }
    }

    // Fallback to basic express-rate-limit
    const basicLimiter = rateLimit({
      windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes
      max: options.max || 100,
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      skipFailedRequests: options.skipFailedRequests || false,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req: Request, res: Response) => {
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please try again later.',
          retryAfter: '15 minutes',
          limit: options.max || 100,
          windowMs: options.windowMs || 15 * 60 * 1000,
          service: 'basic'
        });
      }
    });

    return basicLimiter(req, res, next);
  };
};

// Helper functions for enhanced error handling
const getStatusCodeForViolation = (result: any): number => {
  if (result.tier === UserTier.ENTERPRISE) {
    return 429; // Still 429 but with different context
  }
  if (result.violations?.count > 5) {
    return 429;
  }
  return 429;
};

const getErrorMessageForViolation = (result: any, endpoint: string): string => {
  const baseMessage = 'Rate limit exceeded. Please try again later.';
  
  if (result.tier) {
    return `${baseMessage} Current tier: ${result.tier}. Consider upgrading for higher limits.`;
  }
  
  if (result.adjustmentReason) {
    return `${baseMessage} System is currently under load: ${result.adjustmentReason}`;
  }
  
  return baseMessage;
};

const getViolationType = (result: any): string => {
  if (result.adjustmentReason) {
    return 'dynamic_adjustment';
  }
  if (result.tier) {
    return 'tier_limit';
  }
  return 'basic_limit';
};

// General rate limiter for most endpoints
export const generalLimiter = createEnhancedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  endpoint: 'general',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// Strict rate limiter for sensitive operations
export const strictLimiter = createEnhancedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  endpoint: 'strict',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: false // Disable dynamic for sensitive operations
});

// Proof creation rate limiter
export const proofCreationLimiter = createEnhancedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 50,
  endpoint: 'proof-creation',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// Proof verification rate limiter
export const verificationLimiter = createEnhancedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  endpoint: 'verification',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// Proof update rate limiter
export const proofUpdateLimiter = createEnhancedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  endpoint: 'proof-update',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// Proof deletion rate limiter
export const proofDeletionLimiter = createEnhancedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  endpoint: 'proof-deletion',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: false // Disable dynamic for destructive operations
});

// Batch operations rate limiter
export const batchLimiter = createEnhancedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  endpoint: 'batch-operations',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: false
});

// Search rate limiter
export const searchLimiter = createEnhancedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 50,
  endpoint: 'search',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// Export rate limiter
export const exportLimiter = createEnhancedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  endpoint: 'export',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: false
});

// Sharing rate limiter
export const sharingLimiter = createEnhancedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 25,
  endpoint: 'sharing',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// API endpoint rate limiter (for external API access)
export const apiLimiter = createEnhancedLimiter({
  windowMs: 60 * 1000,
  max: 1000,
  endpoint: 'api',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: true
});

// Webhook rate limiter
export const webhookLimiter = createEnhancedLimiter({
  windowMs: 60 * 1000,
  max: 100,
  endpoint: 'webhook',
  enableUserRateLimiting: true,
  enableTieredRateLimiting: true,
  enableDynamicAdjustment: false
});

// Authentication rate limiter (for login attempts)
export const authLimiter = createEnhancedLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  endpoint: 'auth',
  enableUserRateLimiting: false, // Don't use user-based for auth
  enableTieredRateLimiting: false,
  enableDynamicAdjustment: false
});

// Password reset rate limiter
export const passwordResetLimiter = createEnhancedLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  endpoint: 'password-reset',
  enableUserRateLimiting: false,
  enableTieredRateLimiting: false,
  enableDynamicAdjustment: false
});

// Dynamic rate limiter based on user tier (enhanced version)
export const createDynamicLimiter = (baseLimit: number, windowMs: number, endpoint: string = 'custom') => {
  return createEnhancedLimiter({
    windowMs,
    max: baseLimit,
    endpoint,
    enableUserRateLimiting: true,
    enableTieredRateLimiting: true,
    enableDynamicAdjustment: true
  });
};

// Create rate limiters for different user tiers (enhanced)
export const userTierLimiters = {
  free: createEnhancedLimiter({
    windowMs: 15 * 60 * 1000,
    max: 50,
    endpoint: 'free-tier',
    enableUserRateLimiting: true,
    enableTieredRateLimiting: true,
    enableDynamicAdjustment: true
  }),
  basic: createEnhancedLimiter({
    windowMs: 15 * 60 * 1000,
    max: 150,
    endpoint: 'basic-tier',
    enableUserRateLimiting: true,
    enableTieredRateLimiting: true,
    enableDynamicAdjustment: true
  }),
  premium: createEnhancedLimiter({
    windowMs: 15 * 60 * 1000,
    max: 250,
    endpoint: 'premium-tier',
    enableUserRateLimiting: true,
    enableTieredRateLimiting: true,
    enableDynamicAdjustment: true
  }),
  enterprise: createEnhancedLimiter({
    windowMs: 15 * 60 * 1000,
    max: 500,
    endpoint: 'enterprise-tier',
    enableUserRateLimiting: true,
    enableTieredRateLimiting: true,
    enableDynamicAdjustment: true
  })
};

// Export all rate limiters as a single object for easier import
export const rateLimiter = {
  general: generalLimiter,
  strict: strictLimiter,
  proofCreation: proofCreationLimiter,
  verification: verificationLimiter,
  proofUpdate: proofUpdateLimiter,
  proofDeletion: proofDeletionLimiter,
  batch: batchLimiter,
  search: searchLimiter,
  export: exportLimiter,
  sharing: sharingLimiter,
  api: apiLimiter,
  webhook: webhookLimiter,
  auth: authLimiter,
  passwordReset: passwordResetLimiter
};

// Utility function to create custom rate limiters
export const createCustomRateLimiter = (options: {
  windowMs: number;
  max: number;
  endpoint: string;
  enableUserRateLimiting?: boolean;
  enableTieredRateLimiting?: boolean;
  enableDynamicAdjustment?: boolean;
  message?: string;
}) => {
  return createEnhancedLimiter(options);
};

// Rate limit bypass middleware for emergency situations
export const emergencyBypass = (req: Request, res: Response, next: NextFunction) => {
  const bypassToken = req.headers['x-emergency-bypass'] as string;
  const validToken = process.env.EMERGENCY_BYPASS_TOKEN;
  
  if (bypassToken && validToken && bypassToken === validToken) {
    res.set('X-RateLimit-Bypass', 'emergency');
    return next();
  }
  
  // If no valid bypass token, continue with normal rate limiting
  next();
};

// Rate limit status middleware
export const rateLimitStatus = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/api/rate-limit/status') {
    if (rateLimitService) {
      return rateLimitService.getSystemMetrics()
        .then(metrics => res.json(metrics))
        .catch(error => {
          console.error('Error getting rate limit metrics:', error);
          res.status(500).json({ error: 'Failed to get rate limit metrics' });
        });
    } else {
      return res.json({ 
        error: 'Rate limit service not initialized',
        status: 'basic_only'
      });
    }
  }
  
  next();
};
