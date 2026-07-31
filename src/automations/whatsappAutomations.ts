import { eventBus } from '../events/eventBus';
import { logger } from '../utils/logger';
import * as leadService from '../services/lead.service';

const SYSTEM_USER_ID = process.env.WEBHOOK_SYSTEM_USER_ID || 'system';

export const registerWhatsAppAutomations = () => {
  logger.info('[Automations] Registering WhatsApp Automations...');

  eventBus.subscribe('WhatsApp.MessageReceived', async (payload: { phone: string; name: string; text: string }) => {
    try {
      // LeadService's createLead handles customer deduplication automatically
      // notes is a relation — do NOT pass it as a string field
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
