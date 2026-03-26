# Event-Driven Architecture Implementation

This implementation introduces a comprehensive event-driven architecture to the Verinode backend, enabling better decoupling, scalability, audit trails, and reactive programming patterns.

## 🏗️ Architecture Overview

The event system consists of several key components:

### Core Components

- **EventBus** - Redis-based event publishing and subscription
- **EventStore** - Event sourcing for complete audit trails
- **EventHandlers** - Event processing with retry logic and filtering
- **EventService** - High-level API for event management
- **EventTypes** - Type definitions for all events
- **EventUtils** - Utility functions for event processing
- **Configuration** - Comprehensive event system configuration

## 📁 File Structure

```
backend/src/
├── events/
│   ├── EventBus.ts          # Redis-based event bus implementation
│   ├── EventHandlers.ts      # Event handler registry and execution
│   ├── EventStore.ts         # Event sourcing and storage
│   └── EventTypes.ts         # Type definitions for all events
├── services/
│   └── events/
│       └── EventService.ts   # High-level event service API
├── utils/
│   └── eventUtils.ts         # Event utility functions
├── config/
│   └── events.ts             # Event system configuration
└── tests/
    └── eventSystem.test.ts   # Integration tests
```

## 🚀 Features Implemented

### ✅ Redis-based Event Bus
- High-performance event publishing and subscription
- Connection pooling and failover support
- Channel-based event routing
- Automatic reconnection handling

### ✅ Event Sourcing
- Complete audit trail of all events
- Time-based event queries
- Event replay capabilities
- Configurable retention policies

### ✅ Async Event Processing
- Event handler registry with filtering
- Exponential backoff retry logic
- Dead letter queue for failed events
- Batch processing support

### ✅ Event Replay
- Time-based event replay
- Event type filtering
- Dry-run mode for testing
- Parallel and sequential replay options

### ✅ Performance Monitoring
- Real-time event metrics
- Processing statistics
- Alert rules and notifications
- Performance optimization settings

### ✅ Event Schema Validation
- Type-safe event definitions
- Runtime validation
- Schema enforcement
- Error handling for invalid events

### ✅ Service Integration
- **ProofService** - Emits proof lifecycle events
- **UserService** - Emits user management events  
- **AuthService** - Emits authentication events

## 📊 Event Types

### Proof Events
- `PROOF_CREATED` - When a new proof is created
- `PROOF_VERIFIED` - When a proof verification completes
- `PROOF_UPDATED` - When a proof is modified
- `PROOF_DELETED` - When a proof is deleted

### User Events
- `USER_REGISTERED` - When a new user registers
- `USER_LOGGED_IN` - When a user authenticates
- `USER_UPDATED` - When user information changes
- `USER_DEACTIVATED` - When a user account is deactivated

### Authentication Events
- `AUTH_TOKEN_GENERATED` - When an auth token is created
- `AUTH_TOKEN_REVOKED` - When an auth token is revoked
- `AUTH_FAILED` - When authentication fails
- `PASSWORD_CHANGED` - When a password is updated

### System Events
- `SYSTEM_ERROR` - When system errors occur
- `SYSTEM_METRIC` - Performance and usage metrics

## ⚙️ Configuration

The event system is highly configurable through environment variables:

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_KEY_PREFIX=verinode:events:

# Event Store Configuration
REDIS_EVENT_STORE_DB=1
EVENT_RETENTION_DAYS=90
EVENT_CLEANUP_INTERVAL_HOURS=24

# Dead Letter Queue
EVENT_DLQ_MAX_SIZE=10000
EVENT_DLQ_TTL=604800000

# Monitoring
EVENT_MONITORING_ENABLED=true
EVENT_METRICS_INTERVAL=60000

# Processing
EVENT_BATCH_SIZE=100
EVENT_MAX_RETRIES=3
EVENT_RETRY_BASE_DELAY=1000
EVENT_RETRY_MAX_DELAY=30000

# Security
EVENT_MAX_SIZE=1048576
EVENT_RATE_LIMITING_ENABLED=true
EVENT_RATE_MAX_EVENTS=1000
```

## 🔧 Usage Examples

### Basic Event Publishing

```typescript
import { eventService } from './services/events/EventService';

// Create and publish an event
const event = await eventService.createEvent('PROOF_CREATED', {
  proofId: 'proof_123',
  proofType: 'zk-snark',
  creator: 'user_456',
  commitment: '0x123...',
  verificationKey: '0xabc...',
  publicInputs: ['input1', 'input2']
});

await eventService.publishEvent(event, `proof:${event.payload.proofId}`);
```

### Event Subscription

```typescript
// Subscribe to specific event types
eventService.subscribe('PROOF_CREATED', async (event) => {
  console.log(`New proof created: ${event.payload.proofId}`);
  // Process the event
});

// Subscribe with filtering and retry policy
eventService.subscribe('USER_*', async (event) => {
  // Handle user events
}, {
  filter: (event) => event.payload.userId !== 'system_user',
  retryPolicy: EventUtils.createRetryPolicy({
    maxRetries: 5,
    backoffMs: 2000
  })
});
```

### Event Querying and Replay

```typescript
// Query events
const events = await eventService.getEvents({
  eventTypes: ['PROOF_CREATED', 'PROOF_VERIFIED'],
  timeRange: {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
    end: new Date()
  }
});

// Replay events
const replayResult = await eventService.replayEvents({
  eventTypes: ['PROOF_CREATED'],
  fromTimestamp: new Date('2024-01-01'),
  dryRun: false
});
```

### Metrics and Monitoring

```typescript
// Get processing statistics
const stats = eventService.getProcessingStats();
console.log(`Processed ${stats.totalProcessed} events with ${stats.successRate}% success rate`);

// Get event metrics
const metrics = eventService.getEventMetrics('PROOF_CREATED');
console.log(`Proof creation metrics:`, metrics);

// Configure alert rules
eventService.addAlertRule({
  id: 'high_error_rate',
  name: 'High Error Rate',
  condition: 'high_error_rate',
  threshold: 10,
  timeWindow: 300000,
  severity: 'high',
  enabled: true,
  notifications: ['email', 'slack']
});
```

## 🧪 Testing

Run the integration test to verify the event system:

```bash
cd backend
npm run test:event-system
```

Or run the test directly:

```bash
npx ts-node src/tests/eventSystem.test.ts
```

## 🔄 Migration Guide

### For Existing Code

The event system maintains backward compatibility with existing EventEmitter usage. Services will continue to work with their current event emission while gaining the benefits of the new event-driven architecture.

### Step-by-Step Migration

1. **Import EventService**
   ```typescript
   import { eventService } from './services/events/EventService';
   ```

2. **Create Typed Events**
   ```typescript
   const event = await eventService.createEvent<ProofCreatedEvent>(
     'PROOF_CREATED',
     { /* event data */ }
   );
   ```

3. **Publish Events**
   ```typescript
   await eventService.publishEvent(event, streamId);
   ```

4. **Subscribe to Events**
   ```typescript
   eventService.subscribe('PROOF_CREATED', handler);
   ```

## 📈 Performance Considerations

### Event Throughput
- Supports thousands of events per second
- Redis pub/sub provides low-latency delivery
- Batch processing for high-volume scenarios

### Memory Usage
- Configurable event retention policies
- Automatic cleanup of old events
- Efficient event serialization

### Network Optimization
- Connection pooling for Redis
- Compression for large payloads
- Configurable timeouts and retries

## 🔒 Security Features

### Event Validation
- Schema validation for all events
- Type safety at compile time and runtime
- Sanitization of sensitive data

### Access Control
- Event source validation
- Rate limiting per source
- Configurable allowed/blocked sources

### Data Protection
- Sensitive data redaction in logs
- Optional event encryption
- Secure event storage

## 🚨 Monitoring and Alerting

### Built-in Metrics
- Event processing rates
- Success/failure ratios
- Processing latency
- Queue depths

### Alert Rules
- High error rate detection
- Performance threshold alerts
- Dead letter queue monitoring
- Custom alert conditions

### Integrations
- Email notifications
- Slack integration
- PagerDuty escalation
- Custom webhooks

## 🛠️ Troubleshooting

### Common Issues

1. **Redis Connection Failed**
   - Check Redis server status
   - Verify connection parameters
   - Check network connectivity

2. **Events Not Received**
   - Verify event handler registration
   - Check event type matching
   - Review filter conditions

3. **High Memory Usage**
   - Reduce event retention period
   - Increase cleanup frequency
   - Monitor event volumes

### Debug Mode

Enable debug logging:

```bash
EVENT_LOG_LEVEL=debug
EVENT_LOG_PAYLOADS=true
```

## 📚 API Reference

### EventService

- `initialize()` - Initialize the event service
- `publishEvent(event, streamId?)` - Publish a single event
- `publishEvents(events, streamId?)` - Publish multiple events
- `subscribe(eventType, handler, options?)` - Subscribe to events
- `unsubscribe(eventType, handler)` - Unsubscribe from events
- `getEvents(filter)` - Query events from store
- `replayEvents(options)` - Replay historical events
- `getProcessingStats()` - Get processing statistics
- `getEventMetrics(eventType?)` - Get event metrics

### EventUtils

- `generateEventId()` - Generate unique event ID
- `generateCorrelationId()` - Generate correlation ID
- `validateEvent(event)` - Validate event structure
- `createRetryPolicy(options)` - Create retry policy
- `calculateEventHash(event)` - Calculate event hash
- `groupByCorrelation(events)` - Group events by correlation

## 🤝 Contributing

When adding new event types:

1. Define the event type in `EventTypes.ts`
2. Add schema validation in `events.ts`
3. Update service integration
4. Add tests for the new events
5. Update documentation

## 📄 License

This implementation is part of the Verinode project and follows the same licensing terms.

---

**Note**: This event-driven architecture implementation provides a solid foundation for scalable, maintainable, and observable backend services. The system is designed to be production-ready with comprehensive error handling, monitoring, and security features.
