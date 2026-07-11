import { NotificationChannel } from '@prisma/client';

/**
 * The rendered, provider-ready message.
 * TemplateRenderer produces this. NotificationProvider consumes it.
 */
export interface RenderedMessage {
  to: string;
  subject?: string;          // Email only
  body: string;              // Final rendered text
  template_code: string;
  payload_version: string;
}

/**
 * Structured result from a provider send() attempt.
 * DeliveryService uses this to determine retry vs permanent failure.
 */
export interface DeliveryResult {
  success: boolean;
  provider_message_id?: string;    // Filled by provider on success
  provider_request_id?: string;    // Internal provider trace ID
  http_status?: number;
  provider_error_code?: string;
  error_message?: string;
  duration_ms: number;
  is_permanent_failure: boolean;   // true = don't retry (VALIDATION, auth, bad number)
}

/**
 * Core provider contract. Every delivery adapter implements this.
 * MockProvider, MetaWhatsAppProvider, EmailProvider, SMSProvider all implement this.
 */
export interface NotificationProvider {
  readonly name: string;              // e.g. "META_WHATSAPP", "EMAIL_SES", "MOCK"
  readonly channel: NotificationChannel;

  /** Validate recipient format before attempting delivery (no API call) */
  validate(recipient_id: string): boolean;

  /** Deliver a rendered message. Returns a structured result — never throws. */
  send(message: RenderedMessage): Promise<DeliveryResult>;

  /** Lightweight connectivity check. Returns true if provider is reachable. */
  healthCheck(): Promise<boolean>;
}
