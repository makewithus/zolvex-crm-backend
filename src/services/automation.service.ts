import { PrismaClient, TaskPriority, NotificationChannel, AutomationStatus, NotificationStatus, FailureClassification } from '@prisma/client';
import os from 'os';

const prisma = new PrismaClient();

// Worker identity — stable for the lifetime of this process
export const WORKER_ID = `worker-${process.pid}-${Math.round(Math.random() * 1000)}`;
export const HOSTNAME = os.hostname();

export interface ScheduleTaskInput {
  task_name: string;
  correlation_id?: string;
  metadata: any;       // Extensible JSON replacing hardcoded reference_type
  payload?: any;
  scheduled_for: Date;
  priority?: TaskPriority;
  idempotency_key: string;
}

export interface EnqueueNotificationInput {
  correlation_id?: string;
  recipient_type: string;
  recipient_id: string;
  channel: NotificationChannel;
  provider?: string;
  template_code: string;
  payload_version?: string;
  payload: any;
}

export interface LogExecutionInput {
  correlation_id?: string;
  event_name: string;
  reference_id: string; // Used for idempotency matching (e.g. Booking ID)
  action_taken: string;
  status: AutomationStatus;
  failure_class?: FailureClassification;
  error_message?: string;
  started_at: Date;
  finished_at: Date;
  retry_number?: number;
}

/**
 * Increments an automation counter metric (e.g., "Tasks.Scheduled", "Notifications.Sent")
 */
export const incrementMetric = async (metric_key: string, amount: number = 1) => {
  return await prisma.automationMetric.upsert({
    where: { metric_key },
    create: { metric_key, value: amount },
    update: { value: { increment: amount } }
  });
};

/**
 * Schedules a delayed task using an idempotency key to prevent duplicate insertions.
 */
export const scheduleTask = async (data: ScheduleTaskInput) => {
  const result = await prisma.scheduledTask.upsert({
    where: { idempotency_key: data.idempotency_key },
    create: {
      ...data,
      priority: data.priority || 'NORMAL'
    },
    update: {} // Idempotent: don't overwrite if it already exists
  });

  // Since upsert doesn't tell us if it inserted or updated natively without checking times,
  // we increment metrics naively here. In a stricter setup, we'd check if created_at == updated_at.
  await incrementMetric('Tasks.Scheduled');
  return result;
};

/**
 * Enqueues a notification into the provider-agnostic NotificationQueue.
 */
export const enqueueNotification = async (data: EnqueueNotificationInput) => {
  const result = await prisma.notificationQueue.create({
    data: {
      ...data,
      status: 'PENDING'
    }
  });
  await incrementMetric('Notifications.Enqueued');
  return result;
};

/**
 * Logs the execution of an automation event with full observability fields.
 */
export const logExecution = async (data: LogExecutionInput) => {
  const duration_ms = data.finished_at.getTime() - data.started_at.getTime();

  const log = await prisma.automationExecutionLog.create({
    data: {
      ...data,
      duration_ms,
      hostname: HOSTNAME,
      worker_id: WORKER_ID,
      retry_number: data.retry_number ?? 0
    }
  });

  await incrementMetric(data.status === 'SUCCESS' ? 'Tasks.Executed' : 'Tasks.Failed');
  if (data.retry_number && data.retry_number > 1) {
    await incrementMetric('Tasks.Retried');
  }

  return log;
};

/**
 * Idempotency check: Returns true if this exact event+reference+action has already succeeded.
 */
export const hasExecutionSucceeded = async (
  event_name: string,
  reference_id: string,
  action_taken: string
): Promise<boolean> => {
  const log = await prisma.automationExecutionLog.findFirst({
    where: { event_name, reference_id, action_taken, status: 'SUCCESS' }
  });
  return !!log;
};
