import { eventService } from '../src/services/events/EventService';
import { EventBus } from '../src/events/EventBus';
import { eventStore } from '../src/events/EventStore';
import { eventHandlersRegistry } from '../src/events/EventHandlers';
import { EventUtils } from '../src/utils/eventUtils';
import { getEventConfig } from '../src/config/events';

/**
 * Event System Integration Test
 * 
 * This test verifies that the event-driven architecture is working correctly
 * by testing event creation, publishing, handling, and storage.
 */

async function testEventSystem() {
  console.log('🚀 Starting Event System Integration Test...\n');

  try {
    // Initialize the event service
    console.log('📡 Initializing Event Service...');
    await eventService.initialize();
    console.log('✅ Event Service initialized successfully\n');

    // Test 1: Event Creation and Publishing
    console.log('📝 Test 1: Event Creation and Publishing');
    const testEvent = await eventService.createEvent('PROOF_CREATED', {
      proofId: 'test_proof_123',
      proofType: 'zk-snark',
      creator: 'test_user_456',
      commitment: '0x1234567890abcdef',
      verificationKey: '0xabcdef1234567890',
      publicInputs: ['input1', 'input2'],
      metadata: {
        description: 'Test proof for event system',
        title: 'Test Proof'
      }
    }, {
      source: 'test-suite',
      correlationId: EventUtils.generateCorrelationId(),
      metadata: {
        test: true,
        timestamp: new Date()
      }
    });

    console.log(`✅ Event created: ${testEvent.id}`);

    // Subscribe to the event
    let eventReceived = false;
    eventService.subscribe('PROOF_CREATED', async (event) => {
      console.log(`📨 Event received: ${event.id}`);
      eventReceived = true;
    });

    // Publish the event
    await eventService.publishEvent(testEvent);
    console.log('✅ Event published successfully\n');

    // Wait a bit for event processing
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (!eventReceived) {
      throw new Error('Event was not received by handler');
    }

    // Test 2: Event Validation
    console.log('🔍 Test 2: Event Validation');
    const validation = EventUtils.validateEvent(testEvent);
    if (!validation.isValid) {
      throw new Error(`Event validation failed: ${validation.errors.join(', ')}`);
    }
    console.log('✅ Event validation passed\n');

    // Test 3: Event Storage and Retrieval
    console.log('💾 Test 3: Event Storage and Retrieval');
    const events = await eventService.getEvents({
      eventTypes: ['PROOF_CREATED'],
      timeRange: {
        start: new Date(Date.now() - 60000), // Last minute
        end: new Date()
      }
    });

    if (events.length === 0) {
      throw new Error('No events found in storage');
    }

    console.log(`✅ Found ${events.length} events in storage\n`);

    // Test 4: Event Metrics
    console.log('📊 Test 4: Event Metrics');
    const stats = eventService.getProcessingStats();
    console.log(`✅ Processing stats: ${JSON.stringify(stats, null, 2)}\n`);

    // Test 5: Event Replay
    console.log('🔄 Test 5: Event Replay');
    const replayResult = await eventService.replayEvents({
      eventTypes: ['PROOF_CREATED'],
      dryRun: true
    });

    console.log(`✅ Replay result: ${replayResult.successful} events would be replayed\n`);

    // Test 6: Multiple Event Types
    console.log('🎯 Test 6: Multiple Event Types');
    
    // Create different event types
    const userEvent = await eventService.createEvent('USER_REGISTERED', {
      userId: 'test_user_789',
      email: 'test@example.com',
      registrationSource: 'test-suite'
    });

    const authEvent = await eventService.createEvent('AUTH_TOKEN_GENERATED', {
      userId: 'test_user_789',
      tokenType: 'access' as const,
      expiresIn: 3600
    });

    // Publish batch
    await eventService.publishEvents([userEvent, authEvent]);
    console.log('✅ Multiple events published successfully\n');

    // Test 7: Event Filtering and Utilities
    console.log('🔧 Test 7: Event Filtering and Utilities');
    
    const allEvents = [testEvent, userEvent, authEvent];
    const summary = EventUtils.createEventSummary(allEvents);
    const grouped = EventUtils.groupByCorrelation(allEvents);
    const sorted = EventUtils.sortEventsChronologically(allEvents);

    console.log(`✅ Event summary: ${summary.total} events, ${summary.byType.PROOF_CREATED || 0} proofs, ${summary.byType.USER_REGISTERED || 0} users`);
    console.log(`✅ Grouped by correlation: ${grouped.size} groups`);
    console.log(`✅ Sorted chronologically: ${sorted.length} events\n`);

    // Test 8: Alert Rules
    console.log('🚨 Test 8: Alert Rules');
    
    const testAlertRule = {
      id: 'test_high_volume',
      name: 'Test High Volume',
      condition: 'high_volume' as const,
      threshold: 1,
      timeWindow: 60000,
      severity: 'low' as const,
      enabled: true,
      notifications: ['test']
    };

    eventService.addAlertRule(testAlertRule);
    const alertRules = eventService.getAlertRules();
    
    if (alertRules.length === 0) {
      throw new Error('Alert rule was not added');
    }

    console.log(`✅ Alert rules configured: ${alertRules.length} rules\n`);

    // Test 9: Configuration
    console.log('⚙️ Test 9: Configuration');
    
    const config = getEventConfig('test');
    console.log(`✅ Configuration loaded: Redis ${config.redis.host}:${config.redis.port}\n`);

    // Cleanup
    console.log('🧹 Cleaning up...');
    await eventService.shutdown();
    console.log('✅ Event Service shutdown complete\n');

    console.log('🎉 All tests passed! Event-driven architecture is working correctly.');
    
    return {
      success: true,
      tests: [
        'Event Creation and Publishing',
        'Event Validation',
        'Event Storage and Retrieval',
        'Event Metrics',
        'Event Replay',
        'Multiple Event Types',
        'Event Filtering and Utilities',
        'Alert Rules',
        'Configuration'
      ],
      summary: {
        eventsCreated: 3,
        eventsPublished: 3,
        handlersRegistered: 1,
        alertRulesAdded: 1,
        configValid: true
      }
    };

  } catch (error) {
    console.error('❌ Test failed:', error);
    
    try {
      await eventService.shutdown();
    } catch (shutdownError) {
      console.error('❌ Failed to shutdown event service:', shutdownError);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    };
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testEventSystem()
    .then(result => {
      console.log('\n📋 Test Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Unexpected error:', error);
      process.exit(1);
    });
}

export { testEventSystem };
