import { NotificationProvider, RenderedMessage, DeliveryResult } from './NotificationProvider.interface';
import { NotificationChannel } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * MockProvider — used in Sprint 10.1 and all automated tests.
 *
 * Behaviour is configurable at construction time:
 *   - shouldFail: simulates a transient provider error
 *   - shouldFailPermanently: simulates an invalid number / auth error
 *   - shouldTimeout: simulates a slow provider (exceeds timeout)
 *   - failCount: fail the first N calls, then succeed (for circuit breaker tests)
 */
export class MockProvider implements NotificationProvider {
  readonly name = 'MOCK';
  readonly channel: NotificationChannel;

  private callCount = 0;
  private sentMessages: RenderedMessage[] = [];

  constructor(
    channel: NotificationChannel = 'WHATSAPP',
    private options: {
      shouldFail?: boolean;
      shouldFailPermanently?: boolean;
      shouldTimeout?: boolean;
      failCount?: number;      // Fail first N calls, then succeed
      latencyMs?: number;
    } = {}
  ) {
    this.channel = channel;
  }

  validate(recipient_id: string): boolean {
    // Basic format check: non-empty, at least 6 chars
    return typeof recipient_id === 'string' && recipient_id.trim().length >= 6;
  }

  async send(message: RenderedMessage): Promise<DeliveryResult> {
    const start = Date.now();
    this.callCount++;

    // Simulate configurable latency
    if (this.options.latencyMs) {
      await new Promise(r => setTimeout(r, this.options.latencyMs));
    }

    // Simulate timeout (very long delay)
    if (this.options.shouldTimeout) {
      await new Promise(r => setTimeout(r, 15000));
    }

    // Simulate failCount (fail first N, then succeed)
    if (this.options.failCount && this.callCount <= this.options.failCount) {
      return {
        success: false,
        http_status: 503,
        provider_error_code: 'SERVICE_UNAVAILABLE',
        error_message: `Mock transient failure (call ${this.callCount}/${this.options.failCount})`,
        duration_ms: Date.now() - start,
        is_permanent_failure: false
      };
    }

    if (this.options.shouldFailPermanently) {
      return {
        success: false,
        http_status: 400,
        provider_error_code: 'INVALID_RECIPIENT',
        error_message: 'Mock permanent failure: invalid recipient',
        duration_ms: Date.now() - start,
        is_permanent_failure: true
      };
    }

    if (this.options.shouldFail) {
      return {
        success: false,
        http_status: 503,
        provider_error_code: 'MOCK_TRANSIENT_ERROR',
        error_message: 'Mock transient error',
        duration_ms: Date.now() - start,
        is_permanent_failure: false
      };
    }

    // Success path
    this.sentMessages.push(message);
    const msg_id = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    logger.info(`[MockProvider] SENT ${message.template_code} to ${message.to.slice(0, 4)}**** | id: ${msg_id}`);

    return {
      success: true,
      provider_message_id: msg_id,
      provider_request_id: `req-${msg_id}`,
      http_status: 200,
      duration_ms: Date.now() - start,
      is_permanent_failure: false
    };
  }

  async healthCheck(): Promise<boolean> {
    return !this.options.shouldFail && !this.options.shouldTimeout;
  }

  // Test introspection helpers
  getSentMessages()    { return [...this.sentMessages]; }
  getCallCount()       { return this.callCount; }
  reset()              { this.callCount = 0; this.sentMessages = []; }
}
