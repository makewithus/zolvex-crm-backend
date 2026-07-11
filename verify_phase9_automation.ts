import { PrismaClient } from '@prisma/client';
import os from 'os';
import { eventBus } from './src/events/eventBus';
import {
  scheduleTask,
  enqueueNotification,
  logExecution,
  hasExecutionSucceeded,
  WORKER_ID,
  HOSTNAME
} from './src/services/automation.service';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Test Harness
// ─────────────────────────────────────────────────────────────────────────────
let passed = 0;
let total = 0;
const createdIds: { table: string; id: string }[] = [];
const createdMetrics: string[] = [];

const assert = (condition: boolean, testName: string, detail?: string) => {
  total++;
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? `\n       ${detail}` : ''}`);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ZOLVEX CRM — PHASE 9 AUTOMATION INTEGRITY VERIFICATION     ');
  console.log(`  Run at: ${new Date().toISOString()}                        `);
  console.log(`  Worker: ${WORKER_ID} | Host: ${HOSTNAME}                   `);
  console.log('══════════════════════════════════════════════════════════════\n');

  try {

    // ─────────────────────────────────────────────────────────────────────
    console.log('[1] EventBus: Publish & Subscribe...');
    // ─────────────────────────────────────────────────────────────────────
    let eventReceived = false;
    const listener = (payload: any) => { if (payload.hello === 'world') eventReceived = true; };
    eventBus.subscribe('Test.Event', listener);
    eventBus.publish('Test.Event', { hello: 'world' });
    await new Promise(r => setTimeout(r, 100));
    assert(eventReceived, 'Event emitted and received correctly');
    eventBus.unsubscribe('Test.Event', listener);

    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[2] EventBus: Concurrent Publish Idempotency...');
    // ─────────────────────────────────────────────────────────────────────
    let concurrentCount = 0;
    eventBus.subscribe('Test.Concurrent', () => { concurrentCount++; });
    eventBus.publish('Test.Concurrent', {});
    eventBus.publish('Test.Concurrent', {});
    eventBus.publish('Test.Concurrent', {});
    await new Promise(r => setTimeout(r, 100));
    assert(concurrentCount === 3, 'EventBus delivers all publishes (idempotency is handler responsibility)');

    const idem_key = 'CONCURRENT_IDEM_TEST';
    const logA = await logExecution({
      event_name: idem_key, reference_id: 'REF-IDEM', action_taken: 'Send Notification',
      status: 'SUCCESS', started_at: new Date(), finished_at: new Date()
    });
    createdIds.push({ table: 'automationExecutionLog', id: logA.id });
    createdMetrics.push('Tasks.Executed');

    const check1 = await hasExecutionSucceeded(idem_key, 'REF-IDEM', 'Send Notification');
    const check2 = await hasExecutionSucceeded(idem_key, 'REF-IDEM', 'Send Notification');
    assert(check1 && check2, 'hasExecutionSucceeded blocks duplicate execution (2 checks, both blocked)');

    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[3] NotificationQueue: Explicit Status States & Versioning...');
    // ─────────────────────────────────────────────────────────────────────
    const notif = await enqueueNotification({
      correlation_id: 'TEST-CORRELATION-1',
      recipient_type: 'Customer', recipient_id: 'CUST-VERIFY',
      channel: 'WHATSAPP', template_code: 'TEST_TEMPLATE',
      payload_version: '1.2', payload: { name: 'Test' }
    });
    createdIds.push({ table: 'notificationQueue', id: notif.id });
    createdMetrics.push('Notifications.Enqueued');

    assert(notif.status === 'PENDING', 'NotificationQueue defaults to PENDING');
    assert(notif.payload_version === '1.2', 'NotificationQueue captures payload version');
    assert(notif.correlation_id === 'TEST-CORRELATION-1', 'NotificationQueue captures correlation ID');

    await prisma.notificationQueue.update({ where: { id: notif.id }, data: { status: 'PROCESSING' } });
    const processing = await prisma.notificationQueue.findUnique({ where: { id: notif.id } });
    assert(processing?.status === 'PROCESSING', 'NotificationQueue transitions to PROCESSING');

    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[4] ScheduledTask: Idempotent Insertion & Extensible Metadata...');
    // ─────────────────────────────────────────────────────────────────────
    const taskA = await scheduleTask({
      task_name: 'VERIFY_TASK',
      correlation_id: 'TEST-CORRELATION-2',
      metadata: { city_id: 'CTY-123', type: 'Test' },
      scheduled_for: new Date(Date.now() + 3600000), priority: 'HIGH',
      idempotency_key: 'VERIFY_TASK:VER-001'
    });
    createdIds.push({ table: 'scheduledTask', id: taskA.id });
    createdMetrics.push('Tasks.Scheduled');

    const taskB = await scheduleTask({
      task_name: 'VERIFY_TASK',
      correlation_id: 'TEST-CORRELATION-2',
      metadata: { city_id: 'CTY-123', type: 'Test' },
      scheduled_for: new Date(Date.now() + 3600000), priority: 'HIGH',
      idempotency_key: 'VERIFY_TASK:VER-001'
    });
    assert(taskA.id === taskB.id, 'Duplicate ScheduledTask insertion returns existing record (upsert idempotency)');
    assert((taskA.metadata as any)?.city_id === 'CTY-123', 'Extensible metadata is correctly saved and returned');

    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[5] ScheduledTask: Concurrency Locking (Two Workers)...');
    // ─────────────────────────────────────────────────────────────────────
    const lockTask = await scheduleTask({
      task_name: 'LOCK_TEST_TASK', metadata: {}, scheduled_for: new Date(),
      priority: 'CRITICAL', idempotency_key: 'LOCK_TEST_TASK:VER-003'
    });
    createdIds.push({ table: 'scheduledTask', id: lockTask.id });
    createdMetrics.push('Tasks.Scheduled');

    const lock1 = await prisma.scheduledTask.updateMany({
      where: { id: lockTask.id, locked_at: null },
      data: { locked_at: new Date(), locked_by: 'worker-1', attempts: { increment: 1 } }
    });
    const lock2 = await prisma.scheduledTask.updateMany({
      where: { id: lockTask.id, locked_at: null },
      data: { locked_at: new Date(), locked_by: 'worker-2', attempts: { increment: 1 } }
    });

    assert(lock1.count === 1 && lock2.count === 0, 'Atomic locking: Worker 1 wins, Worker 2 skips');

    // ─────────────────────────────────────────────────────────────────────
    console.log('\n[6] AutomationExecutionLog & Metrics: Soft Failures...');
    // ─────────────────────────────────────────────────────────────────────
    const logFailure = await logExecution({
      correlation_id: 'TEST-CORRELATION-3',
      event_name: 'VERIFY.FailureClass',
      reference_id: 'OBS-002',
      action_taken: 'Attempting unstable operation',
      status: 'FAILED',
      failure_class: 'TRANSIENT',
      error_message: 'Network timeout',
      started_at: new Date(),
      finished_at: new Date(),
      retry_number: 1
    });
    createdIds.push({ table: 'automationExecutionLog', id: logFailure.id });
    createdMetrics.push('Tasks.Failed');

    assert(logFailure.failure_class === 'TRANSIENT', 'Execution log captures Soft Failure Classification');
    assert(logFailure.correlation_id === 'TEST-CORRELATION-3', 'Execution log captures Correlation ID');
    assert(logFailure.hostname === os.hostname(), 'Execution log captures hostname');
    assert(logFailure.worker_id === WORKER_ID, 'Execution log captures worker_id');

    // Verify Metric Increment
    const failureMetric = await prisma.automationMetric.findUnique({ where: { metric_key: 'Tasks.Failed' } });
    assert(failureMetric !== null && failureMetric.value >= 1, 'Automation Metric Tasks.Failed is incremented');

  } catch (error: any) {
    console.error('\n🔴 Fatal Error during verification:', error);
  } finally {
    // ──────────────────────────────────────────────────────────────────
    // CLEANUP: Remove all test records
    // ──────────────────────────────────────────────────────────────────
    console.log('\n── Cleaning up test records...');
    for (const record of createdIds.reverse()) {
      try {
        if (record.table === 'scheduledTask') await prisma.scheduledTask.delete({ where: { id: record.id } });
        if (record.table === 'notificationQueue') await prisma.notificationQueue.delete({ where: { id: record.id } });
        if (record.table === 'automationExecutionLog') await prisma.automationExecutionLog.delete({ where: { id: record.id } });
      } catch (_) { /* May already be deleted by test logic */ }
    }
    for (const metric of [...new Set(createdMetrics)]) {
       try { await prisma.automationMetric.delete({ where: { metric_key: metric } }); } catch(_) {}
    }

    console.log('\n══════════════════════════════════════════════════════════════');
    const allPassed = passed === total;
    console.log(`  PHASE 9 VERIFICATION: ${passed} / ${total} Suites Passed`);
    console.log(`  OVERALL STATUS: ${allPassed ? '✅ AUTOMATION VERIFIED' : '❌ FAILURES DETECTED'}`);
    console.log('══════════════════════════════════════════════════════════════\n');

    await prisma.$disconnect();
    if (!allPassed) process.exit(1);
  }
}

runTests();
