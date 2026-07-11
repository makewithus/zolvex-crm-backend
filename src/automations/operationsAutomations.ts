import { eventBus } from '../events/eventBus';
import { scheduleTask, enqueueNotification, logExecution, hasExecutionSucceeded } from '../services/automation.service';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { addMinutes, addHours } from 'date-fns';

const prisma = new PrismaClient();

export const registerOperationsAutomations = () => {
  logger.info('[Automations] Registering Sprint 9.3 operations automation handlers...');

  // ────────────────────────────────────────────────────────────────────────────
  // 1. TECHNICIAN ASSIGNMENT ALERT (Immediate)
  // Trigger: Job.Assigned (or created with assignment)
  // Action:  Enqueue notification to Technician immediately
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('Job.Assigned', async (payload: { job_id: string; assigned_user_id: string }) => {
    const started_at = new Date();
    const action_taken = 'Queued Technician Assignment Alert';
    const correlation_id = `JOB-ASSIGN-${payload.job_id}-${Date.now()}`;

    // Idempotency: don't alert the same technician multiple times for the exact same job assignment event
    if (await hasExecutionSucceeded('Job.Assigned', `${payload.job_id}:${payload.assigned_user_id}`, action_taken)) {
      return;
    }

    try {
      const job = await prisma.job.findUnique({
        where: { id: payload.job_id },
        include: { assignedUser: true, booking: true }
      });

      if (!job || !job.assignedUser || !job.assignedUser.phone) return;

      await enqueueNotification({
        correlation_id,
        recipient_type: 'Staff',
        recipient_id: job.assignedUser.phone,
        channel: 'WHATSAPP',
        template_code: 'JOB_ASSIGNMENT_ALERT',
        payload_version: '1.0',
        payload: {
          technician_name: job.assignedUser.name,
          job_id: job.job_id,
          customer_name: job.booking.customer_name,
          scheduled_start: job.scheduled_start,
          address: `${job.booking.address_line_1}, ${job.booking.city_name}`
        }
      });

      // Schedule follow-ups: Acceptance Reminder (30m) & Escalation (1h)
      await scheduleTask({
        task_name: 'JOB_ACCEPTANCE_REMINDER',
        correlation_id,
        metadata: { job_id: job.id, assigned_user_id: job.assigned_user_id },
        scheduled_for: addMinutes(new Date(), 30),
        priority: 'HIGH',
        idempotency_key: `JOB_ACCEPTANCE_REMINDER:${job.id}:${job.assigned_user_id}`
      });

      await scheduleTask({
        task_name: 'JOB_ESCALATION_1H',
        correlation_id,
        metadata: { job_id: job.id, assigned_user_id: job.assigned_user_id },
        scheduled_for: addHours(new Date(), 1),
        priority: 'CRITICAL',
        idempotency_key: `JOB_ESCALATION_1H:${job.id}:${job.assigned_user_id}`
      });

      await logExecution({
        correlation_id,
        event_name: 'Job.Assigned',
        reference_id: `${payload.job_id}:${payload.assigned_user_id}`,
        action_taken,
        status: 'SUCCESS',
        started_at,
        finished_at: new Date()
      });
    } catch (error: any) {
      logger.error('[Automations] Failed Job Assignment Alert:', error);
      await logExecution({
        correlation_id,
        event_name: 'Job.Assigned',
        reference_id: `${payload.job_id}:${payload.assigned_user_id}`,
        action_taken,
        status: 'FAILED',
        failure_class: 'INTERNAL',
        error_message: error.message,
        started_at,
        finished_at: new Date()
      });
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. JOB ACCEPTANCE REMINDER (30 min)
  // Trigger: ScheduledTask
  // Action:  Verify if Job is still 'Assigned' -> notify Technician again
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('ScheduledTask.JOB_ACCEPTANCE_REMINDER', async (task: any) => {
    const metadata = task.metadata || {};
    if (!metadata.job_id) return;

    const job = await prisma.job.findUnique({
      where: { id: metadata.job_id },
      include: { assignedUser: true, booking: true }
    });

    // STATE VALIDATION: Must still exist, still be Assigned, to the same user
    if (!job || job.status !== 'Assigned' || job.assigned_user_id !== metadata.assigned_user_id || !job.assignedUser?.phone) {
      return; // Already accepted or reassigned/cancelled
    }

    await enqueueNotification({
      correlation_id: task.correlation_id ?? undefined,
      recipient_type: 'Staff',
      recipient_id: job.assignedUser.phone,
      channel: 'WHATSAPP',
      template_code: 'JOB_ACCEPTANCE_REMINDER',
      payload_version: '1.0',
      payload: { technician_name: job.assignedUser.name, job_id: job.job_id }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. JOB ESCALATION (1 HOUR)
  // Trigger: ScheduledTask
  // Action:  Verify if Job is still 'Assigned' -> notify Manager
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('ScheduledTask.JOB_ESCALATION_1H', async (task: any) => {
    const metadata = task.metadata || {};
    if (!metadata.job_id) return;

    const job = await prisma.job.findUnique({
      where: { id: metadata.job_id },
      include: { assignedUser: true, booking: { include: { city: true } } }
    });

    if (!job || job.status !== 'Assigned' || job.assigned_user_id !== metadata.assigned_user_id) {
      return; // State changed, no escalation needed
    }

    // Find the manager for this city
    const manager = await prisma.user.findFirst({
      where: { city_id: job.booking.city_id, role: { name: 'City Manager' } }
    });

    if (!manager || !manager.phone) return;

    await enqueueNotification({
      correlation_id: task.correlation_id ?? undefined,
      recipient_type: 'Staff',
      recipient_id: manager.phone,
      channel: 'WHATSAPP',
      template_code: 'JOB_ESCALATION',
      payload_version: '1.0',
      payload: {
        manager_name: manager.name,
        technician_name: job.assignedUser?.name || 'Unknown',
        job_id: job.job_id
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. LEAD FOLLOW-UP REMINDER (24h)
  // Trigger: Lead.Created
  // Action:  Schedule 24h reminder for assigned user
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('Lead.Created', async (payload: { lead_id: string }) => {
    const started_at = new Date();
    const action_taken = 'Scheduled Lead Reminders';
    const correlation_id = `LEAD-REM-${payload.lead_id}-${Date.now()}`;

    if (await hasExecutionSucceeded('Lead.Created', payload.lead_id, action_taken)) return;

    try {
      await scheduleTask({
        task_name: 'LEAD_FOLLOWUP_24H',
        correlation_id,
        metadata: { lead_id: payload.lead_id },
        scheduled_for: addHours(new Date(), 24),
        priority: 'NORMAL',
        idempotency_key: `LEAD_FOLLOWUP_24H:${payload.lead_id}`
      });

      // 5. MANAGER ESCALATION (48h) scheduled simultaneously
      await scheduleTask({
        task_name: 'LEAD_MANAGER_ESCALATION_48H',
        correlation_id,
        metadata: { lead_id: payload.lead_id },
        scheduled_for: addHours(new Date(), 48),
        priority: 'HIGH',
        idempotency_key: `LEAD_MANAGER_ESCALATION_48H:${payload.lead_id}`
      });

      await logExecution({
        correlation_id, event_name: 'Lead.Created', reference_id: payload.lead_id,
        action_taken, status: 'SUCCESS', started_at, finished_at: new Date()
      });
    } catch (error: any) {
      await logExecution({
        correlation_id, event_name: 'Lead.Created', reference_id: payload.lead_id,
        action_taken, status: 'FAILED', failure_class: 'INTERNAL', error_message: error.message,
        started_at, finished_at: new Date()
      });
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4b. EXECUTE LEAD FOLLOW-UP REMINDER (24h)
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('ScheduledTask.LEAD_FOLLOWUP_24H', async (task: any) => {
    const metadata = task.metadata || {};
    if (!metadata.lead_id) return;

    const lead = await prisma.lead.findUnique({
      where: { id: metadata.lead_id },
      include: { assignedTo: true }
    });

    // STATE VALIDATION: Must be 'New' and assigned
    if (!lead || lead.status !== 'New' || !lead.assignedTo || !lead.assignedTo.phone) return;

    await enqueueNotification({
      correlation_id: task.correlation_id ?? undefined,
      recipient_type: 'Staff',
      recipient_id: lead.assignedTo.phone,
      channel: 'WHATSAPP',
      template_code: 'LEAD_FOLLOWUP_REMINDER',
      payload_version: '1.0',
      payload: { staff_name: lead.assignedTo.name, lead_phone: lead.phone }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. MANAGER ESCALATION (48h Lead)
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('ScheduledTask.LEAD_MANAGER_ESCALATION_48H', async (task: any) => {
    const metadata = task.metadata || {};
    if (!metadata.lead_id) return;

    const lead = await prisma.lead.findUnique({
      where: { id: metadata.lead_id },
      include: { assignedTo: true, city: true }
    });

    if (!lead || lead.status !== 'New' || !lead.city_id) return;

    const manager = await prisma.user.findFirst({
      where: { city_id: lead.city_id, role: { name: 'City Manager' } }
    });

    if (!manager || !manager.phone) return;

    await enqueueNotification({
      correlation_id: task.correlation_id ?? undefined,
      recipient_type: 'Staff',
      recipient_id: manager.phone,
      channel: 'WHATSAPP',
      template_code: 'LEAD_MANAGER_ESCALATION',
      payload_version: '1.0',
      payload: {
        manager_name: manager.name,
        lead_phone: lead.phone,
        assigned_to: lead.assignedTo?.name || 'Unassigned'
      }
    });
  });

};
