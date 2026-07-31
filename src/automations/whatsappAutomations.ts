import { eventBus } from '../events/eventBus';
import { logger } from '../utils/logger';
import * as leadService from '../services/lead.service';

const SYSTEM_USER_ID = process.env.WEBHOOK_SYSTEM_USER_ID;

export const registerWhatsAppAutomations = () => {
  logger.info('[Automations] Registering WhatsApp Automations...');

  if (!SYSTEM_USER_ID) {
    logger.error('[Automations] FATAL: WEBHOOK_SYSTEM_USER_ID is not configured. WhatsApp automations will fail.');
  }

  eventBus.subscribe('WhatsApp.MessageReceived', async (payload: { phone: string; name: string; text: string }) => {
    try {
      if (!SYSTEM_USER_ID) {
        throw new Error('WEBHOOK_SYSTEM_USER_ID is missing from environment. Cannot attribute Lead ownership.');
      }

      // LeadService's createLead handles customer deduplication automatically
      const lead = await leadService.createLead({
        phone: payload.phone,
        name: payload.name,
        source: 'WhatsApp',
      }, SYSTEM_USER_ID);

      // Attach the WhatsApp message text as a LeadNote on the newly created lead
      if (payload.text) {
        await leadService.createLeadNote(lead.id, `WhatsApp: ${payload.text}`, SYSTEM_USER_ID);
      }

      logger.info(`[WhatsAppAutomations] Lead evaluated/created for ${payload.phone}`);
    } catch (error: any) {
      logger.error(`[WhatsAppAutomations] Failed to process incoming WhatsApp message for lead: ${error.message}`);
    }
  });
};
