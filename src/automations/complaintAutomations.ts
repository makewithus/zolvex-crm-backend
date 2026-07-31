import { eventBus } from '../events/eventBus';
import { logger } from '../utils/logger';
import { enqueueNotification, hasExecutionSucceeded, logExecution } from '../services/automation.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const registerComplaintAutomations = () => {
  logger.info('[Automations] Registering Complaint Automations...');

  const handleComplaintEvent = async (event_name: string, payload: { complaint_id: string }, template_code: string) => {
    const started_at = new Date();
    const action_taken = `Queued ${template_code}`;

    if (await hasExecutionSucceeded(event_name, payload.complaint_id, action_taken)) {
      return;
    }

    try {
      const complaint = await prisma.complaint.findUnique({
        where: { id: payload.complaint_id },
        include: { customer: true }
      });

      if (!complaint || !complaint.customer?.phone) return;

      await enqueueNotification({
        correlation_id: `CMP-${event_name}-${complaint.id}-${Date.now()}`,
        recipient_type: 'Customer',
        recipient_id: complaint.customer.phone,
        channel: 'WHATSAPP',
        template_code,
        payload_version: '1.0',
        payload: {
          customer_name: complaint.customer.name,
          complaint_id: complaint.complaint_id,
          status: complaint.status,
          subject: complaint.subject
        }
      });

      await logExecution({
        event_name,
        reference_id: payload.complaint_id,
        action_taken,
        status: 'SUCCESS',
        started_at,
        finished_at: new Date()
      });
    } catch (error: any) {
      logger.error(`[Automations] Failed to process complaint event ${event_name}: ${error.message}`);
      await logExecution({
        event_name,
        reference_id: payload.complaint_id,
        action_taken,
        status: 'FAILED',
        failure_class: 'INTERNAL',
        error_message: error.message,
        started_at,
        finished_at: new Date()
      });
    }
  };

  eventBus.subscribe('Complaint.Created', (payload) => handleComplaintEvent('Complaint.Created', payload, 'COMPLAINT_CREATED'));
  eventBus.subscribe('Complaint.Resolved', (payload) => handleComplaintEvent('Complaint.Resolved', payload, 'COMPLAINT_RESOLVED'));
  eventBus.subscribe('Complaint.Escalated', (payload) => handleComplaintEvent('Complaint.Escalated', payload, 'COMPLAINT_ESCALATED'));
};
