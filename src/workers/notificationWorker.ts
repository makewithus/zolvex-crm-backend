import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { deliveryService } from '../providers/DeliveryService';
import { getProvider, healthRegistry } from '../providers/registry';
import { WORKER_ID } from '../services/automation.service';

const prisma = new PrismaClient();

const BATCH_SIZE = parseInt(process.env.NOTIFICATION_WORKER_BATCH_SIZE || '20', 10);
const STALE_PROCESSING_MINUTES = 5; // Auto-release PROCESSING rows older than this

/**
 * NOTIFICATION WORKER
 *
 * Polls NotificationQueue every 10 seconds.
 * Separate from CronSweeper (Phase 9) — different table, different purpose.
 *
 * Responsibilities:
 *   1. Poll for PENDING rows
 *   2. Atomically acquire each row (PENDING → PROCESSING)
 *   3. Call DeliveryService.deliver()
 *   4. Recovery: reset stale PROCESSING rows (worker crash recovery)
 *   5. Scheduled health checks (every 5 minutes)
 *
 * Does NOT contain any business logic.
 * Does NOT call any frozen service.
 */
export const startNotificationWorker = () => {
  logger.info(`[NotificationWorker] Starting on worker: ${WORKER_ID}`);

  // Main delivery loop: every 10 seconds
  cron.schedule('*/10 * * * * *', async () => {
    try {
      await releaseStaleProcessing();
      await processPendingNotifications();
    } catch (err) {
      logger.error('[NotificationWorker] Fatal error in sweep cycle:', err);
    }
  });

  // Provider health check: every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    await runHealthChecks();
  });

  logger.info(`[NotificationWorker] Polling every 10s | batch: ${BATCH_SIZE} | stale recovery: ${STALE_PROCESSING_MINUTES}m`);
};

// ── Core Processing Loop ──────────────────────────────────────────────────────

const processPendingNotifications = async () => {
  // Atomic batch acquisition: set status=PROCESSING for up to BATCH_SIZE PENDING rows
  // We read candidates, then lock each one individually with updateMany (compare-and-swap)
  const candidates = await prisma.notificationQueue.findMany({
    where: { status: 'PENDING' },
    orderBy: { created_at: 'asc' },
    take: BATCH_SIZE,
    select: { id: true }
  });

  if (candidates.length === 0) return;

  logger.info(`[NotificationWorker] Processing ${candidates.length} notification(s)`);

  for (const candidate of candidates) {
    // Atomic lock: only acquire if still PENDING
    const locked = await prisma.notificationQueue.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'PROCESSING' }
    });

    if (locked.count === 0) {
      // Another worker claimed it — skip
      continue;
    }

    // Deliver via DeliveryService
    const outcome = await deliveryService.deliver(candidate.id);

    logger.info(
      `[NotificationWorker] ${outcome.status} | id: ${candidate.id} | ${outcome.duration_ms}ms` +
      (outcome.error ? ` | ${outcome.error}` : '') +
      (outcome.provider_message_id ? ` | msgId: ${outcome.provider_message_id}` : '')
    );
  }
};

// ── Stale PROCESSING Recovery ─────────────────────────────────────────────────
// If a worker crashes mid-delivery, the row stays in PROCESSING.
// This resets rows older than STALE_PROCESSING_MINUTES to PENDING for retry.

const releaseStaleProcessing = async () => {
  const threshold = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000);
  const stale = await prisma.notificationQueue.updateMany({
    where: {
      status: 'PROCESSING',
      // updated_at not on NotificationQueue schema — use created_at as proxy
      // In Sprint 10.2 we add updated_at to NotificationQueue if needed
      // For now, compare created_at (conservative — only catches very old stuck rows)
      created_at: { lt: threshold }
    },
    data: { status: 'PENDING' }
  });

  if (stale.count > 0) {
    logger.warn(`[NotificationWorker] Released ${stale.count} stale PROCESSING notification(s)`);
  }
};

// ── Provider Health Checks ────────────────────────────────────────────────────

const runHealthChecks = async () => {
  const channels: Array<'WHATSAPP' | 'EMAIL' | 'SMS'> = ['WHATSAPP', 'EMAIL', 'SMS'];

  for (const channel of channels) {
    const provider = getProvider(channel);
    if (!provider) continue;

    try {
      const start = Date.now();
      const healthy = await provider.healthCheck();
      const latency = Date.now() - start;

      if (healthy) {
        healthRegistry.recordSuccess(provider.name, latency);
      } else {
        healthRegistry.recordFailure(provider.name, latency);
      }

      logger.info(`[NotificationWorker] Health[${provider.name}]: ${healthy ? '✅' : '❌'} (${latency}ms)`);
    } catch (err: any) {
      healthRegistry.recordFailure(provider.name);
      logger.error(`[NotificationWorker] Health check failed for ${provider.name}:`, err.message);
    }
  }
};
