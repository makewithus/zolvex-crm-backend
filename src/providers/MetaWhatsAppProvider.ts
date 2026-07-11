import axios, { AxiosError } from 'axios';
import { NotificationProvider, RenderedMessage, DeliveryResult } from './NotificationProvider.interface';
import { NotificationChannel } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * META WHATSAPP PROVIDER — Sprint 10.2 (Sandbox/Test)
 *
 * Implements the NotificationProvider interface against the Meta Cloud API.
 * Zero knowledge of bookings, jobs, invoices, or any frozen CRM module.
 *
 * Production switch:
 *   - Set PROVIDER_MODE=sandbox in .env
 *   - Provide META_ACCESS_TOKEN + META_PHONE_NUMBER_ID
 *   - No other file changes required
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 */
export class MetaWhatsAppProvider implements NotificationProvider {
  readonly name = 'META_WHATSAPP';
  readonly channel: NotificationChannel = 'WHATSAPP';

  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.accessToken  = process.env.META_ACCESS_TOKEN   ?? '';
    this.phoneNumberId = process.env.META_PHONE_NUMBER_ID ?? '';
    this.apiVersion   = process.env.META_WHATSAPP_API_VERSION ?? 'v18.0';
    this.baseUrl      = process.env.META_WHATSAPP_BASE_URL ?? 'https://graph.facebook.com';
    this.timeoutMs    = parseInt(process.env.NOTIFICATION_PROVIDER_TIMEOUT_MS ?? '10000', 10);
  }

  /**
   * Validates E.164 phone number format strictly — no spaces allowed.
   * Meta requires: +[country code][number], no spaces, no dashes.
   * Upstream must provide clean numbers. Delivery layer never mutates the recipient.
   */
  validate(recipient_id: string): boolean {
    // Strict E.164: starts with +, 7–15 digits, NO spaces or other characters
    return /^\+[1-9]\d{6,14}$/.test(recipient_id);
  }

  async send(message: RenderedMessage): Promise<DeliveryResult> {
    const start = Date.now();

    if (!this.accessToken || !this.phoneNumberId) {
      return {
        success: false,
        http_status: 0,
        provider_error_code: 'MISSING_CREDENTIALS',
        error_message: 'META_ACCESS_TOKEN or META_PHONE_NUMBER_ID not configured',
        duration_ms: Date.now() - start,
        is_permanent_failure: false // Don't permanently fail — config issue
      };
    }

    const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}/messages`;

    /**
     * Meta Cloud API payload.
     *
     * In sandbox mode we use 'text' type (free-form) since sandbox doesn't
     * require pre-approved template HSMs. In production, switch to 'template'
     * type with approved template names.
     *
     * Sandbox text message format:
     *   { messaging_product, to, type: 'text', text: { body } }
     *
     * Production template format (Sprint 10.2 → production migration):
     *   { messaging_product, to, type: 'template', template: { name, language, components } }
     */
    const requestBody = {
      messaging_product: 'whatsapp',
      to: message.to.replace(/\s/g, ''),  // Ensure no spaces
      type: 'text',
      text: { body: message.body }
      // Production upgrade path (uncomment when templates are approved):
      // type: 'template',
      // template: {
      //   name: message.template_code,
      //   language: { code: 'en_IN' },
      //   components: []  // Populated from payload by Sprint 10.3
      // }
    };

    try {
      const response = await axios.post(url, requestBody, {
        timeout: this.timeoutMs,
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const msgId = response.data?.messages?.[0]?.id;
      const wamId = response.data?.messages?.[0]?.message_status ?? 'accepted';

      logger.info(
        `[MetaWhatsApp] SENT ${message.template_code} | msgId: ${msgId} | to: ${this._maskPhone(message.to)}`
      );

      return {
        success: true,
        provider_message_id: msgId,
        provider_request_id: response.headers['x-fb-trace-id'] ?? undefined,
        http_status: response.status,
        duration_ms: Date.now() - start,
        is_permanent_failure: false
      };

    } catch (err) {
      return this._handleError(err, start);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.accessToken || !this.phoneNumberId) return false;

    try {
      // Lightweight check: read the phone number details (no message sent)
      const url = `${this.baseUrl}/${this.apiVersion}/${this.phoneNumberId}`;
      const response = await axios.get(url, {
        timeout: 5000,
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private _handleError(err: unknown, start: number): DeliveryResult {
    const duration_ms = Date.now() - start;

    if (err instanceof AxiosError) {
      const status   = err.response?.status ?? 0;
      const errData  = err.response?.data?.error ?? {};
      const errCode  = errData.code?.toString()   ?? err.code ?? 'UNKNOWN';
      const errMsg   = errData.message            ?? err.message;
      const errType  = errData.type               ?? '';

      // SECURITY: never log bearer tokens, message bodies, or recipient phones
      logger.error(
        `[MetaWhatsApp] FAILED | status: ${status} | code: ${errCode} | type: ${errType} | ` +
        `is_permanent: ${this._isPermanent(status, errCode)}`
      );

      return {
        success: false,
        http_status: status,
        provider_error_code: errCode,
        provider_request_id: err.response?.headers?.['x-fb-trace-id'] ?? undefined,
        error_message: errMsg,
        duration_ms,
        is_permanent_failure: this._isPermanent(status, errCode)
      };
    }

    // Network/timeout error — always transient
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`[MetaWhatsApp] Network error: ${msg}`);
    return {
      success: false,
      error_message: msg,
      duration_ms,
      is_permanent_failure: false
    };
  }

  /**
   * Classifies whether a Meta API error is permanent (no retry) or transient (retry).
   *
   * Permanent:
   *   - 400 Bad Request (malformed payload)
   *   - 401 Unauthorized (auth failure — don't retry until credentials change)
   *   - 403 Forbidden
   *   - 131026: Recipient phone not a valid WhatsApp number
   *   - 131047: Re-engagement window expired
   *
   * Transient (always retry):
   *   - 429 Rate limit
   *   - 500/503 Server errors
   *   - Network timeouts
   */
  private _isPermanent(httpStatus: number, errorCode: string): boolean {
    const permanentCodes = ['131026', '131047', '131051', '131052', '132000'];
    if (permanentCodes.includes(errorCode)) return true;
    if (httpStatus === 401 || httpStatus === 403) return true;
    if (httpStatus === 400) return true;
    return false;
  }

  private _maskPhone(phone: string): string {
    if (phone.length <= 5) return '****';
    return phone.slice(0, 4) + '****' + phone.slice(-2);
  }
}
