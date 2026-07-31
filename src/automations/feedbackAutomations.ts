import { eventBus } from '../events/eventBus';
import { logger } from '../utils/logger';
import { enqueueNotification, hasExecutionSucceeded, logExecution } from '../services/automation.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const registerFeedbackAutomations = () => {
  logger.info('[Automations] Registering Feedback Automations...');

  eventBus.subscribe('Job.Completed', async (payload: { job_id: string }) => {
    const started_at = new Date();
    const action_taken = 'Queued Feedback Request';

    if (await hasExecutionSucceeded('Job.Completed', payload.job_id, action_taken)) {
      return;
    }

    try {
      const job = await prisma.job.findUnique({
        where: { id: payload.job_id },
        include: { booking: { include: { customer: true } } }
      });

      if (!job || !job.booking?.customer?.phone) return;

      await enqueueNotification({
        correlation_id: `FDBK-REQ-${job.id}`,
        recipient_type: 'Customer',
        recipient_id: job.booking.customer.phone,
        channel: 'WHATSAPP',
        template_code: 'FEEDBACK_REQUEST',
        payload_version: '1.0',
        payload: {
          customer_name: job.booking.customer.name,
          service_name: job.booking.service_name,
          job_id: job.job_id
        }
      });

      await logExecution({
        event_name: 'Job.Completed',
        reference_id: payload.job_id,
        action_taken,
        status: 'SUCCESS',
        started_at,
        finished_at: new Date()
      });
    } catch (error: any) {
      logger.error(`[Automations] Failed to queue feedback request: ${error.message}`);
      await logExecution({
        event_name: 'Job.Completed',
        reference_id: payload.job_id,
        action_taken,
        status: 'FAILED',
        failure_class: 'INTERNAL',
        error_message: error.message,
        started_at,
        finished_at: new Date()
      });
    }
  });
};
