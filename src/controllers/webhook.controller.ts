/**
 * WEBSITE LEAD WEBHOOK CONTROLLER
 *
 * Receives lead submissions from the client's website form.
 * Calls the existing createLead() service — no new business logic.
 *
 * Security:
 *   - Verifies X-Webhook-Secret header (constant-time comparison)
 *   - Feature-flagged: WEBSITE_WEBHOOK_ENABLED must be 'true'
 *   - Rate-limited at route level
 *   - Always responds 200 before processing (idempotent intake)
 *
 * Lead source: 'WebsiteForm' (already in the LeadSource enum)
 */

import { Request, Response } from 'express';
import * as crypto from 'crypto';
import * as leadService from '../services/lead.service';
import { logger } from '../utils/logger';

// The system user ID used for webhook-created leads (must exist in the DB)
// Set WEBHOOK_SYSTEM_USER_ID in .env, or fall back to a known admin UUID
const SYSTEM_USER_ID = process.env.WEBHOOK_SYSTEM_USER_ID || 'system';

/**
 * POST /api/v1/webhook/lead
 * Public endpoint — verified by X-Webhook-Secret header only.
 */
export const receiveWebsiteLead = async (req: Request, res: Response) => {
  // Feature flag check
  if (process.env.WEBSITE_WEBHOOK_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }

  // Always respond 200 first (prevent retries on slow processing)
  res.status(200).json({ received: true });

  try {
    // Verify secret
    const incomingSecret = req.headers['x-webhook-secret'] as string;
    const expectedSecret = process.env.WEBSITE_WEBHOOK_SECRET || '';
    if (!incomingSecret || !crypto.timingSafeEqual(
      Buffer.from(incomingSecret),
      Buffer.from(expectedSecret)
    )) {
      logger.warn('[WebhookLead] Invalid webhook secret — request rejected');
      return;
    }

    const { phone, name, service_id, city_id, message } = req.body;

    if (!phone) {
      logger.warn('[WebhookLead] Missing phone — skipping lead creation');
      return;
    }

    await leadService.createLead({
      phone,
      name: name || null,
      source: 'WebsiteForm',
      city_id: city_id || null,
      service_id: service_id || null,
      notes: message || null,
    }, SYSTEM_USER_ID);

    logger.info(`[WebhookLead] Lead created for phone ${phone} from WebsiteForm`);
  } catch (err: any) {
    // Never throw — the 200 response is already sent
    logger.error(`[WebhookLead] Failed to create lead: ${err.message}`);
  }
};

/**
 * GET /api/v1/webhook/lead
 * Health check for the webhook endpoint (allows the website to verify it's live)
 */
export const webhookHealth = (_req: Request, res: Response) => {
  if (process.env.WEBSITE_WEBHOOK_ENABLED !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ status: 'ok', endpoint: 'website-lead-webhook' });
};
