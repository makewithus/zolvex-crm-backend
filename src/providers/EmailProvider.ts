import nodemailer, { Transporter } from 'nodemailer';
import { NotificationProvider, RenderedMessage, DeliveryResult } from './NotificationProvider.interface';
import { NotificationChannel } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * EMAIL PROVIDER — Sprint 10.2 (SMTP / Test via Ethereal)
 *
 * Implements the NotificationProvider interface via Nodemailer.
 * Supports any SMTP server: Ethereal (test), Gmail, AWS SES, Mailgun.
 *
 * In test mode (Ethereal):
 *   SMTP_HOST=smtp.ethereal.email
 *   SMTP_PORT=587
 *   SMTP_USER=<ethereal user>
 *   SMTP_PASS=<ethereal pass>
 *
 * Production: replace with AWS SES / Mailgun SMTP credentials.
 * Zero changes to NotificationWorker, DeliveryService, or Automation.
 */
export class EmailProvider implements NotificationProvider {
  readonly name = 'EMAIL_SMTP';
  readonly channel: NotificationChannel = 'EMAIL';

  private transporter: Transporter | null = null;
  private readonly host:    string;
  private readonly port:    number;
  private readonly user:    string;
  private readonly pass:    string;
  private readonly from:    string;

  constructor() {
    this.host = process.env.SMTP_HOST         ?? '';
    this.port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    this.user = process.env.SMTP_USER         ?? '';
    this.pass = process.env.SMTP_PASS         ?? '';
    this.from = process.env.EMAIL_FROM_ADDRESS ?? 'noreply@zolvex.in';
  }

  /**
   * Validates a basic email address format before any SMTP call.
   * RFC 5322 simplified: user@domain.tld
   */
  validate(recipient_id: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipient_id.trim().toLowerCase());
  }

  async send(message: RenderedMessage): Promise<DeliveryResult> {
    const start = Date.now();

    if (!this.host || !this.user || !this.pass) {
      return {
        success: false,
        http_status: 0,
        provider_error_code: 'MISSING_CREDENTIALS',
        error_message: 'SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) not configured',
        duration_ms: Date.now() - start,
        is_permanent_failure: false // Config issue — not the message's fault
      };
    }

    try {
      const transport = this._getTransporter();
      const info = await transport.sendMail({
        from:    `"ZOLVEX CRM" <${this.from}>`,
        to:      message.to,
        subject: message.subject ?? 'Notification from ZOLVEX CRM',
        text:    message.body,
        // html:  future — build HTML template in Sprint 10.3
      });

      // SECURITY: log only message ID and masked recipient
      logger.info(
        `[EmailProvider] SENT ${message.template_code} | msgId: ${info.messageId} | to: ${this._maskEmail(message.to)}`
      );

      return {
        success: true,
        provider_message_id: info.messageId,
        provider_request_id: info.envelope?.from ?? undefined,
        http_status: 250, // SMTP 250 OK
        duration_ms: Date.now() - start,
        is_permanent_failure: false
      };

    } catch (err: any) {
      return this._handleError(err, start);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.host || !this.user || !this.pass) return false;

    try {
      const transport = this._getTransporter();
      await transport.verify();
      return true;
    } catch {
      return false;
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────────────

  private _getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host:   this.host,
        port:   this.port,
        secure: this.port === 465,  // SSL for port 465, STARTTLS for others
        auth: {
          user: this.user,
          pass: this.pass
        },
        // SECURITY: never log auth credentials
        logger: false,
        debug:  false
      });
    }
    return this.transporter;
  }

  private _handleError(err: Error, start: number): DeliveryResult {
    const duration_ms = Date.now() - start;
    const msg = err.message ?? 'Unknown SMTP error';
    const code = (err as any).code ?? 'SMTP_ERROR';

    // SECURITY: strip credentials from error messages if they somehow appear
    const safeMsg = msg.replace(/(password|pass|auth|token)[^\s]*/gi, '****');

    // Classify SMTP errors
    const isPermanent = this._isPermanent(code, msg);

    logger.error(
      `[EmailProvider] FAILED | code: ${code} | is_permanent: ${isPermanent} | msg: ${safeMsg}`
    );

    return {
      success: false,
      provider_error_code: code,
      error_message: safeMsg,
      duration_ms,
      is_permanent_failure: isPermanent
    };
  }

  /**
   * SMTP permanent failures (don't retry):
   *   - 5xx permanent errors (message rejected)
   *   - Invalid address (550, 551, 553)
   *   - Authentication failure (535)
   *
   * Transient (retry):
   *   - 4xx temporary errors (server busy, rate limit)
   *   - Connection timeout (ECONNREFUSED, ETIMEDOUT)
   */
  private _isPermanent(code: string, message: string): boolean {
    if (/^5[0-9]{2}/.test(code)) return true;               // SMTP 5xx
    if (code === 'EAUTH') return true;                       // Authentication failure
    if (message.includes('550') || message.includes('551') || message.includes('553')) return true;
    return false;
  }

  private _maskEmail(email: string): string {
    const [user, domain] = email.split('@');
    if (!domain) return '****@****';
    const masked = user.length <= 2 ? '**' : user[0] + '****' + user[user.length - 1];
    return `${masked}@${domain}`;
  }
}
