import { eventBus } from '../events/eventBus';
import { logger } from '../utils/logger';
import * as whatsappService from '../services/whatsapp.service';

/**
 * Conversation Automation
 * Handles all WhatsApp conversation persistence in an event-driven manner.
 * Controllers publish events — this listener owns the storage responsibility.
 *
 * Events handled:
 *   - WhatsApp.ConversationReceived → store thread + inbound message
 *   - WhatsApp.StatusUpdate         → update message delivery/read status
 *
 * Completely isolated from Lead creation, Booking, Job, Complaint, and Feedback flows.
 */
export const registerConversationAutomations = () => {
  logger.info('[Automations] Registering WhatsApp Conversation Automations...');

  // Inbound message received — create/update thread and store message
  eventBus.subscribe(
    'WhatsApp.ConversationReceived',
    async (payload: { phone: string; name: string; text: string; meta_message_id?: string }) => {
      try {
        const thread = await whatsappService.getOrCreateThread(payload.phone, payload.name);
        await whatsappService.saveInboundMessage(thread.id, payload.text, payload.meta_message_id);
        logger.info(`[ConversationAutomation] Stored inbound message in thread ${thread.id}`);
      } catch (error: any) {
        logger.error(`[ConversationAutomation] Failed to store inbound message: ${error.message}`);
      }
    }
  );

  // Delivery/read status update from Meta — update message status only
  // Fully isolated: does NOT affect lead creation, automations, or any other CRM flow
  eventBus.subscribe(
    'WhatsApp.StatusUpdate',
    async (payload: { meta_message_id: string; status: string }) => {
      try {
        await whatsappService.updateMessageStatus(payload.meta_message_id, payload.status);
        logger.info(
          `[ConversationAutomation] Updated message status: ${payload.meta_message_id} → ${payload.status}`
        );
      } catch (error: any) {
        logger.error(`[ConversationAutomation] Failed to update message status: ${error.message}`);
      }
    }
  );
};
