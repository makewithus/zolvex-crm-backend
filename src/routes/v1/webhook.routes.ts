/**
 * WEBSITE LEAD WEBHOOK ROUTES
 *
 * Mounted at /api/v1/webhook — NO auth middleware (public endpoint).
 * Security is via X-Webhook-Secret header verification inside the controller.
 *
 * Feature flag: WEBSITE_WEBHOOK_ENABLED=true (default: false)
 *
 * Note: Add express-rate-limit (npm i express-rate-limit) before enabling
 * in production to protect against DoS on the public endpoint.
 */

import { Router } from 'express';
import * as webhookCtrl from '../../controllers/webhook.controller';

const router = Router();

router.get('/lead',  webhookCtrl.webhookHealth);
router.post('/lead', webhookCtrl.receiveWebsiteLead);

export default router;
