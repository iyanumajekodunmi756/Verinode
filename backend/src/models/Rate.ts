import { Schema, model, Document } from 'mongoose';

// Rate Limit Rule Schema
export interface IRateLimitRule extends Document {
  name: string;
  description: string;
  endpoint: string;
  method: string;
  tier: 'free' | 'basic' | 'premium' | 'enterprise' | 'custom';
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
  enabled: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitRuleSchema = new Schema<IRateLimitRule>({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  endpoint: {
    type: String,
    required: true,
    trim: true
  },
  method: {
    type: String,
    required: true,
    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    default: 'GET'
  },
  tier: {
    type: String,
    required: true,
    enum: ['free', 'basic', 'premium', 'enterprise', 'custom'],
    default: 'free'
  },
  limits: {
    requestsPerMinute: {
      type: Number,
      required: true,
      min: 0
    },
    requestsPerHour: {
      type: Number,
      required: true,
      min: 0
    },
    requestsPerDay: {
      type: Number,
      required: true,
      min: 0
    },
    requestsPerMonth: {
      type: Number,
      required: true,
      min: 0
    }
  },
  features: {
    burstAllowance: {
      type: Number,
      default: 0,
      min: 0
    },
    prioritySupport: {
      type: Boolean,
      default: false
    },
    customEndpoints: {
      type: Boolean,
      default: false
    },
    advancedAnalytics: {
      type: Boolean,
      default: false
    },
    emergencyBypass: {
      type: Boolean,
      default: false
    }
  },
  enabled: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Rate Limit Violation Schema
export interface IRateLimitViolation extends Document {
  userId?: string;
  ipAddress: string;
  endpoint: string;
  method: string;
  tier: string;
  violationType: 'minute' | 'hour' | 'day' | 'month' | 'endpoint';
  limitExceeded: number;
  actualRequests: number;
  userAgent?: string;
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  notes?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const RateLimitViolationSchema = new Schema<IRateLimitViolation>({
  userId: {
    type: String,
    index: true
  },
  ipAddress: {
    type: String,
    required: true,
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    index: true
  },
  method: {
    type: String,
    required: true
  },
  tier: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise', 'custom']
  },
  violationType: {
    type: String,
    required: true,
    enum: ['minute', 'hour', 'day', 'month', 'endpoint']
  },
  limitExceeded: {
    type: Number,
    required: true
  },
  actualRequests: {
    type: Number,
    required: true
  },
  userAgent: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  resolved: {
    type: Boolean,
    default: false
  },
  resolvedAt: Date,
  resolvedBy: String,
  notes: String,
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  }
}, {
  timestamps: true
});

// Rate Limit Analytics Schema
export interface IRateLimitAnalytics extends Document {
  date: Date;
  endpoint: string;
  method: string;
  tier: string;
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  averageResponseTime: number;
  peakRequestsPerMinute: number;
  uniqueUsers: number;
  uniqueIPs: number;
  systemLoad: {
    cpuUsage: number;
    memoryUsage: number;
    activeConnections: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitAnalyticsSchema = new Schema<IRateLimitAnalytics>({
  date: {
    type: Date,
    required: true,
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    index: true
  },
  method: {
    type: String,
    required: true
  },
  tier: {
    type: String,
    enum: ['free', 'basic', 'premium', 'enterprise', 'custom']
  },
  totalRequests: {
    type: Number,
    required: true,
    min: 0
  },
  blockedRequests: {
    type: Number,
    required: true,
    min: 0
  },
  allowedRequests: {
    type: Number,
    required: true,
    min: 0
  },
  averageResponseTime: {
    type: Number,
    required: true,
    min: 0
  },
  peakRequestsPerMinute: {
    type: Number,
    required: true,
    min: 0
  },
  uniqueUsers: {
    type: Number,
    required: true,
    min: 0
  },
  uniqueIPs: {
    type: Number,
    required: true,
    min: 0
  },
  systemLoad: {
    cpuUsage: Number,
    memoryUsage: Number,
    activeConnections: Number
  }
}, {
  timestamps: true
});

// Rate Limit User Schema
export interface IRateLimitUser extends Document {
  userId: string;
  email?: string;
  tier: 'free' | 'basic' | 'premium' | 'enterprise' | 'custom';
  customLimits?: Map<string, {
    requestsPerMinute: number;
    requestsPerHour: number;
    requestsPerDay: number;
    requestsPerMonth: number;
  }>;
  specialFeatures: {
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
  usage: {
    currentMonth: {
      requests: number;
      endpointBreakdown: Map<string, number>;
    };
    lastMonth: {
      requests: number;
      endpointBreakdown: Map<string, number>;
    };
    allTime: {
      requests: number;
      endpointBreakdown: Map<string, number>;
    };
  };
  violations: {
    count: number;
    lastViolation: Date;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitUserSchema = new Schema<IRateLimitUser>({
  userId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: String,
  tier: {
    type: String,
    required: true,
    enum: ['free', 'basic', 'premium', 'enterprise', 'custom'],
    default: 'free'
  },
  customLimits: {
    type: Map,
    of: {
      requestsPerMinute: Number,
      requestsPerHour: Number,
      requestsPerDay: Number,
      requestsPerMonth: Number
    }
  },
  specialFeatures: {
    burstMultiplier: {
      type: Number,
      default: 1,
      min: 1
    },
    priorityMultiplier: {
      type: Number,
      default: 1,
      min: 1
    },
    bypassLimits: {
      type: Boolean,
      default: false
    },
    whitelist: {
      type: Boolean,
      default: false
    }
  },
  subscription: {
    planId: String,
    status: {
      type: String,
      enum: ['active', 'inactive', 'cancelled', 'expired'],
      default: 'inactive'
    },
    startDate: Date,
    endDate: Date,
    autoRenew: {
      type: Boolean,
      default: false
    }
  },
  usage: {
    currentMonth: {
      requests: {
        type: Number,
        default: 0
      },
      endpointBreakdown: {
        type: Map,
        of: Number,
        default: new Map()
      }
    },
    lastMonth: {
      requests: {
        type: Number,
        default: 0
      },
      endpointBreakdown: {
        type: Map,
        of: Number,
        default: new Map()
      }
    },
    allTime: {
      requests: {
        type: Number,
        default: 0
      },
      endpointBreakdown: {
        type: Map,
        of: Number,
        default: new Map()
      }
    }
  },
  violations: {
    count: {
      type: Number,
      default: 0
    },
    lastViolation: Date,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'low'
    }
  }
}, {
  timestamps: true
});

// Rate Limit Alert Schema
export interface IRateLimitAlert extends Document {
  type: 'limit_exceeded' | 'tier_upgrade' | 'emergency_mode' | 'system_load' | 'anomaly_detected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  ipAddress?: string;
  endpoint?: string;
  message: string;
  data: Schema.Types.Mixed;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitAlertSchema = new Schema<IRateLimitAlert>({
  type: {
    type: String,
    required: true,
    enum: ['limit_exceeded', 'tier_upgrade', 'emergency_mode', 'system_load', 'anomaly_detected']
  },
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical']
  },
  userId: String,
  ipAddress: String,
  endpoint: String,
  message: {
    type: String,
    required: true
  },
  data: Schema.Types.Mixed,
  acknowledged: {
    type: Boolean,
    default: false
  },
  acknowledgedBy: String,
  acknowledgedAt: Date,
  resolved: {
    type: Boolean,
    default: false
  },
  resolvedBy: String,
  resolvedAt: Date
}, {
  timestamps: true
});

// Rate Limit Configuration Schema
export interface IRateLimitConfiguration extends Document {
  key: string;
  value: Schema.Types.Mixed;
  description: string;
  category: 'general' | 'tiers' | 'dynamic' | 'emergency' | 'notifications';
  editable: boolean;
  requiresRestart: boolean;
  lastModifiedBy?: string;
  lastModifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RateLimitConfigurationSchema = new Schema<IRateLimitConfiguration>({
  key: {
    type: String,
    required: true,
    unique: true
  },
  value: Schema.Types.Mixed,
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['general', 'tiers', 'dynamic', 'emergency', 'notifications']
  },
  editable: {
    type: Boolean,
    default: true
  },
  requiresRestart: {
    type: Boolean,
    default: false
  },
  lastModifiedBy: String,
  lastModifiedAt: Date
}, {
  timestamps: true
});

// Create indexes for better performance
RateLimitViolationSchema.index({ userId: 1, timestamp: -1 });
RateLimitViolationSchema.index({ ipAddress: 1, timestamp: -1 });
RateLimitViolationSchema.index({ endpoint: 1, timestamp: -1 });

RateLimitAnalyticsSchema.index({ date: -1, endpoint: 1 });
RateLimitAnalyticsSchema.index({ date: -1, tier: 1 });

RateLimitAlertSchema.index({ type: 1, createdAt: -1 });
RateLimitAlertSchema.index({ severity: 1, createdAt: -1 });
RateLimitAlertSchema.index({ userId: 1, createdAt: -1 });

// Static methods for RateLimitUser
RateLimitUserSchema.statics.findByUserId = function(userId: string) {
  return this.findOne({ userId });
};

RateLimitUserSchema.statics.updateUsage = function(userId: string, endpoint: string, increment: number = 1) {
  return this.updateOne(
    { userId },
    { 
      $inc: { 
        'usage.currentMonth.requests': increment,
        'usage.allTime.requests': increment,
        [`usage.currentMonth.endpointBreakdown.${endpoint}`]: increment,
        [`usage.allTime.endpointBreakdown.${endpoint}`]: increment
      }
    },
    { upsert: true }
  );
};

RateLimitUserSchema.statics.incrementViolations = function(userId: string, severity: 'low' | 'medium' | 'high' | 'critical' = 'low') {
  return this.updateOne(
    { userId },
    { 
      $inc: { 'violations.count': 1 },
      $set: { 
        'violations.lastViolation': new Date(),
        'violations.severity': severity
      }
    },
    { upsert: true }
  );
};

// Static methods for RateLimitViolation
RateLimitViolationSchema.statics.findByUserId = function(userId: string, limit: number = 100) {
  return this.find({ userId })
    .sort({ timestamp: -1 })
    .limit(limit);
};

RateLimitViolationSchema.statics.findByIPAddress = function(ipAddress: string, limit: number = 100) {
  return this.find({ ipAddress })
    .sort({ timestamp: -1 })
    .limit(limit);
};

RateLimitViolationSchema.statics.findUnresolved = function() {
  return this.find({ resolved: false })
    .sort({ timestamp: -1 });
};

// Static methods for RateLimitAnalytics
RateLimitAnalyticsSchema.statics.getDailyStats = function(date: Date, endpoint?: string) {
  const query = { 
    date: {
      $gte: new Date(date.setHours(0, 0, 0, 0)),
      $lt: new Date(date.setHours(23, 59, 59, 999))
    }
  };
  
  if (endpoint) {
    (query as any).endpoint = endpoint;
  }
  
  return this.find(query).sort({ endpoint: 1 });
};

RateLimitAnalyticsSchema.statics.getMonthlyStats = function(year: number, month: number) {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  
  return this.aggregate([
    {
      $match: {
        date: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$tier',
        totalRequests: { $sum: '$totalRequests' },
        blockedRequests: { $sum: '$blockedRequests' },
        allowedRequests: { $sum: '$allowedRequests' },
        averageResponseTime: { $avg: '$averageResponseTime' },
        uniqueUsers: { $sum: '$uniqueUsers' },
        uniqueIPs: { $sum: '$uniqueIPs' }
      }
    }
  ]);
};

// Static methods for RateLimitAlert
RateLimitAlertSchema.statics.findUnacknowledged = function() {
  return this.find({ acknowledged: false })
    .sort({ createdAt: -1 });
};

RateLimitAlertSchema.statics.findBySeverity = function(severity: string) {
  return this.find({ severity })
    .sort({ createdAt: -1 });
};

RateLimitAlertSchema.statics.acknowledgeAlert = function(alertId: string, acknowledgedBy: string) {
  return this.updateOne(
    { _id: alertId },
    { 
      acknowledged: true,
      acknowledgedBy,
      acknowledgedAt: new Date()
    }
  );
};

// Static methods for RateLimitConfiguration
RateLimitConfigurationSchema.statics.getByCategory = function(category: string) {
  return this.find({ category }).sort({ key: 1 });
};

RateLimitConfigurationSchema.statics.upsertConfig = function(key: string, value: any, description: string, category: string, lastModifiedBy?: string) {
  return this.findOneAndUpdate(
    { key },
    { 
      value,
      description,
      category,
      lastModifiedBy,
      lastModifiedAt: new Date()
    },
    { upsert: true, new: true }
  );
};

// Export models
export const RateLimitRule = model<IRateLimitRule>('RateLimitRule', RateLimitRuleSchema);
export const RateLimitViolation = model<IRateLimitViolation>('RateLimitViolation', RateLimitViolationSchema);
export const RateLimitAnalytics = model<IRateLimitAnalytics>('RateLimitAnalytics', RateLimitAnalyticsSchema);
export const RateLimitUser = model<IRateLimitUser>('RateLimitUser', RateLimitUserSchema);
export const RateLimitAlert = model<IRateLimitAlert>('RateLimitAlert', RateLimitAlertSchema);
export const RateLimitConfiguration = model<IRateLimitConfiguration>('RateLimitConfiguration', RateLimitConfigurationSchema);
