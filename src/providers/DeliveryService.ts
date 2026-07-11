import { PrismaClient, NotificationChannel } from '@prisma/client';
import { logger } from '../utils/logger';
import { templateRenderer } from './TemplateRenderer';
import { getProvider, getBreaker, healthRegistry } from './registry';
import { incrementMetric, logExecution, WORKER_ID, HOSTNAME } from '../services/automation.service';

const prisma = new PrismaClient();

/**
 * DELIVERY SERVICE
 *
 * Single responsibility: take one NotificationQueue row and deliver it.
 *
 * The NotificationWorker only:
 *   1. Polls the queue
 *   2. Acquires atomic lock
 *   3. Calls DeliveryService.deliver()
 *   4. Handles the returned status
 *
 * Everything inside a delivery attempt lives here:
 *   - Template rendering
 *   - Recipient validation
 *   - Circuit breaker check
 *   - Provider send
 *   - Result classification
 *   - DB status update
 *   - Execution logging
 *   - Metric increment
 *   - Health registry update
 */

export interface DeliveryOutcome {
  notificationId: string;
  status: 'SENT' | 'RETRYING' | 'FAILED';
  provider_message_id?: string;
  duration_ms: number;
  error?: string;
}

export class DeliveryService {
  async deliver(notificationId: string): Promise<DeliveryOutcome> {
    const started_at = new Date();

    // ── Re-read from DB — never trust stale in-memory state ──────────────────
    const notif = await prisma.notificationQueue.findUnique({
      where: { id: notificationId }
    });

    if (!notif) {
      logger.warn(`[DeliveryService] Notification ${notificationId} not found — may have been deleted`);
      return { notificationId, status: 'FAILED', duration_ms: 0, error: 'Record not found' };
    }

    // Skip CANCELLED notifications silently
    if (notif.status === 'CANCELLED') {
      await incrementMetric('Notifications.Cancelled');
      return { notificationId, status: 'FAILED', duration_ms: 0, error: 'CANCELLED — skipped' };
    }

    const channel = notif.channel as NotificationChannel;
    const provider = getProvider(channel);
    const breaker  = getBreaker(channel);

    // ── 1. VALIDATION ────────────────────────────────────────────────────────
    if (!provider) {
      return this._permanentFail(notif, started_at, `No provider registered for channel: ${channel}`);
    }

    if (!provider.validate(notif.recipient_id)) {
      await incrementMetric('Notifications.Failed');
      await this._writeLog(notif, 'FAILED', 'VALIDATION', `Invalid recipient: ${this._maskRecipient(notif.recipient_id)}`, started_at);
      await prisma.notificationQueue.update({
        where: { id: notif.id },
        data: { status: 'FAILED', error_message: 'Invalid recipient format', attempts: { increment: 1 } }
      });
      return { notificationId, status: 'FAILED', duration_ms: ms(started_at), error: 'VALIDATION: invalid recipient' };
    }

    // ── 2. CIRCUIT BREAKER CHECK ─────────────────────────────────────────────
    if (breaker && !breaker.canSend()) {
      logger.warn(`[DeliveryService] Circuit OPEN for ${provider.name} — skipping ${notificationId}`);
      // Release the lock so it retries on next sweep (don't increment attempts)
      await prisma.notificationQueue.update({
        where: { id: notif.id },
        data: { status: 'PENDING' }
      });
      return { notificationId, status: 'RETRYING', duration_ms: ms(started_at), error: 'Circuit OPEN' };
    }

    // ── 3. TEMPLATE RENDERING ────────────────────────────────────────────────
    let rendered;
    try {
      rendered = templateRenderer.render(
        notif.template_code,
        notif.payload as Record<string, any>,
        notif.payload_version,
        notif.recipient_id
      );
    } catch (renderError: any) {
      return this._permanentFail(notif, started_at, `Template render error: ${renderError.message}`);
    }

    // ── 4. PROVIDER SEND ─────────────────────────────────────────────────────
    const result = await Promise.race([
      provider.send(rendered),
      timeoutAfter(parseInt(process.env.NOTIFICATION_PROVIDER_TIMEOUT_MS || '10000', 10))
    ]).catch((err) => ({
      success: false as const,
      error_message: `Timeout or fatal error: ${err.message}`,
      duration_ms: ms(started_at),
      is_permanent_failure: false
    }));

    const duration_ms = result.duration_ms ?? ms(started_at);

    // ── 5. RESULT CLASSIFICATION ─────────────────────────────────────────────
    if (result.success) {
      breaker?.recordSuccess();
      healthRegistry.recordSuccess(provider.name, duration_ms);

      await prisma.notificationQueue.update({
        where: { id: notif.id },
        data: {
          status: 'SENT',
          sent_at: new Date(),
          provider: provider.name,
          provider_message_id: result.provider_message_id,
          attempts: { increment: 1 }
        }
      });

      await this._writeLog(notif, 'SUCCESS', undefined, undefined, started_at, result.provider_message_id, duration_ms);
      await incrementMetric('Notifications.Sent');

      return { notificationId, status: 'SENT', provider_message_id: result.provider_message_id, duration_ms };
    }

    // ── FAILURE PATH ─────────────────────────────────────────────────────────
    breaker?.recordFailure();
    healthRegistry.recordFailure(provider.name, duration_ms);

    const newAttempts = notif.attempts + 1;
    const isPermanent = result.is_permanent_failure || newAttempts >= notif.max_attempts;

    if (isPermanent) {
      await prisma.notificationQueue.update({
        where: { id: notif.id },
        data: {
          status: 'FAILED',
          error_message: result.error_message,
          provider: provider.name,
          attempts: newAttempts
        }
      });
      await this._writeLog(notif, 'FAILED', result.is_permanent_failure ? 'PERMANENT' : 'PROVIDER', result.error_message, started_at, undefined, duration_ms);
      await incrementMetric('Notifications.Failed');
      return { notificationId, status: 'FAILED', duration_ms, error: result.error_message };
    }

    // Transient — release lock for retry
    await prisma.notificationQueue.update({
      where: { id: notif.id },
      data: {
        status: 'PENDING',
        error_message: result.error_message,
        attempts: newAttempts
      }
    });
    await this._writeLog(notif, 'FAILED', 'TRANSIENT', result.error_message, started_at, undefined, duration_ms);
    await incrementMetric('Notifications.Retried');
    return { notificationId, status: 'RETRYING', duration_ms, error: result.error_message };
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async _permanentFail(notif: any, started_at: Date, error: string): Promise<DeliveryOutcome> {
    await prisma.notificationQueue.update({
      where: { id: notif.id },
      data: { status: 'FAILED', error_message: error, attempts: { increment: 1 } }
    });
    await this._writeLog(notif, 'FAILED', 'PERMANENT', error, started_at);
    await incrementMetric('Notifications.Failed');
    return { notificationId: notif.id, status: 'FAILED', duration_ms: ms(started_at), error };
  }

  private async _writeLog(
    notif: any,
    status: 'SUCCESS' | 'FAILED',
    failure_class?: string,
    error_message?: string,
    started_at?: Date,
    provider_message_id?: string,
    duration_ms?: number
  ) {
    try {
      await logExecution({
        correlation_id: notif.correlation_id ?? undefined,
        event_name: status === 'SUCCESS' ? 'Notification.Delivered' : 'Notification.Failed',
        reference_id: notif.id,
        action_taken: `${notif.provider || notif.channel} → ${notif.template_code}${provider_message_id ? ` [${provider_message_id}]` : ''}`,
        status: status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        failure_class: failure_class as any,
        error_message,
        started_at: started_at ?? new Date(),
        finished_at: new Date(),
        retry_number: notif.attempts
      });
    } catch (e) {
      logger.error('[DeliveryService] Failed to write execution log:', e);
    }
  }

  private _maskRecipient(id: string): string {
    if (id.length <= 6) return '****';
    return id.slice(0, 3) + '****' + id.slice(-2);
  }
}

export const deliveryService = new DeliveryService();

// ── Helpers ───────────────────────────────────────────────────────────────────

function ms(from: Date): number { return Date.now() - from.getTime(); }

function timeoutAfter(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Provider timeout after ${ms}ms`)), ms)
  );
}
