import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { eventBus } from '../events/eventBus';
import { WORKER_ID, logExecution } from '../services/automation.service';

const prisma = new PrismaClient();

// Lock expiry window: tasks locked longer than this are considered abandoned (worker crashed)
const LOCK_EXPIRY_MINUTES = 10;

export const startCronSweeper = () => {
  logger.info(`[CronSweeper] Starting automation sweeper on worker: ${WORKER_ID}`);

  // Main sweep: runs every minute to pick up due scheduled tasks
  cron.schedule('* * * * *', async () => {
    try {
      await unlockStaleTasks();
      await processScheduledTasks();
    } catch (error) {
      logger.error('[CronSweeper] Fatal error in sweep cycle:', error);
    }
  });

  // Daily bulk scan at 1:00 AM (IST = UTC+5:30 → 19:30 UTC)
  // Publishes a single event; business handlers schedule individual tasks
  cron.schedule('0 1 * * *', () => {
    logger.info('[CronSweeper] Emitting daily system scan event');
    eventBus.publish('System.DailyScan', { timestamp: new Date() });
  });
};

/**
 * LOCK EXPIRY RECOVERY
 * Releases tasks whose lock_at is older than LOCK_EXPIRY_MINUTES.
 * This handles the case where a worker crashed mid-execution.
 * The task will be picked up on the next sweep cycle by any available worker.
 */
const unlockStaleTasks = async () => {
  const expiry = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000);

  const stale = await prisma.scheduledTask.updateMany({
    where: {
      locked_at: { lt: expiry },
      locked_by: { not: null }
    },
    data: {
      locked_at: null,
      locked_by: null,
      last_error: `Lock expired after ${LOCK_EXPIRY_MINUTES}m — assumed worker crash`
    }
  });

  if (stale.count > 0) {
    logger.warn(`[CronSweeper] Released ${stale.count} stale lock(s) older than ${LOCK_EXPIRY_MINUTES} minutes`);
  }
};

/**
 * TASK PROCESSOR
 * Picks up due, unlocked tasks below max_attempts.
 * Uses an atomic updateMany as a compare-and-swap lock to prevent double execution.
 * On success: deletes the task (it is fully captured in AutomationExecutionLog).
 * On failure: releases the lock so the next sweep can retry.
 * On max attempts exceeded: moves to FAILED log and deletes the task permanently.
 */
const processScheduledTasks = async () => {
  const pendingTasks = await prisma.scheduledTask.findMany({
    where: {
      scheduled_for: { lte: new Date() },
      locked_at: null
    },
    orderBy: [
      { priority: 'desc' }, // CRITICAL → HIGH → NORMAL → LOW via DB enum ordering
      { scheduled_for: 'asc' }
    ],
    take: 50
  });

  if (pendingTasks.length === 0) return;

  for (const task of pendingTasks) {
    const started_at = new Date();
    const reference = task.correlation_id || task.idempotency_key;

    // ── MAX ATTEMPTS GUARD ───────────────────────────────────────────────────
    if (task.attempts >= task.max_attempts) {
      logger.error(`[CronSweeper] Task ${task.task_name} (ID: ${task.id}) exceeded max attempts. Marking FAILED.`);
      await logExecution({
        correlation_id: task.correlation_id ?? undefined,
        event_name: task.task_name,
        reference_id: reference,
        action_taken: 'Task permanently failed — max attempts exceeded',
        status: 'FAILED',
        failure_class: 'PERMANENT',
        error_message: task.last_error || 'Max attempts exceeded',
        started_at,
        finished_at: new Date(),
        retry_number: task.attempts
      });
      await prisma.scheduledTask.delete({ where: { id: task.id } });
      continue;
    }

    // ── ATOMIC LOCK ACQUISITION (compare-and-swap) ───────────────────────────
    const locked = await prisma.scheduledTask.updateMany({
      where: {
        id: task.id,
        locked_at: null // Guard: only acquire if still unlocked
      },
      data: {
        locked_at: new Date(),
        locked_by: WORKER_ID,
        attempts: { increment: 1 }
      }
    });

    if (locked.count === 0) {
      // Another worker won the race. Skip silently.
      continue;
    }

    // ── EXECUTION ────────────────────────────────────────────────────────────
    try {
      logger.info(`[CronSweeper] [${WORKER_ID}] Executing: ${task.task_name} | ref: ${reference}`);

      // Dispatch to event bus so the registered handler does the real work.
      // The API thread is NEVER involved in this execution path.
      eventBus.publish(`ScheduledTask.${task.task_name}`, task);

      // Record the successful execution
      await logExecution({
        correlation_id: task.correlation_id ?? undefined,
        event_name: task.task_name,
        reference_id: reference,
        action_taken: `Dispatched ScheduledTask.${task.task_name}`,
        status: 'SUCCESS',
        started_at,
        finished_at: new Date(),
        retry_number: task.attempts + 1 // +1 because increment is in the same transaction
      });

      // Delete the task — it is now fully captured in the execution log
      await prisma.scheduledTask.delete({ where: { id: task.id } });

    } catch (error: any) {
      const finished_at = new Date();
      logger.error(`[CronSweeper] Task ${task.task_name} failed (attempt ${task.attempts + 1}):`, error);

      // Release the lock so the next sweep can retry
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          locked_at: null,
          locked_by: null,
          last_error: error.message || 'Unknown error'
        }
      });

      await logExecution({
        correlation_id: task.correlation_id ?? undefined,
        event_name: task.task_name,
        reference_id: reference,
        action_taken: `Dispatched ScheduledTask.${task.task_name}`,
        status: 'FAILED',
        failure_class: 'INTERNAL',
        error_message: error.message,
        started_at,
        finished_at,
        retry_number: task.attempts + 1
      });
    }
  }
};
