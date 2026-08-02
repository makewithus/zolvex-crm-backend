import { eventBus } from '../events/eventBus';
import { scheduleTask, enqueueNotification, logExecution, hasExecutionSucceeded } from '../services/automation.service';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { addHours, subHours } from 'date-fns';

const prisma = new PrismaClient();

/**
 * AUTOMATION REGISTRY — Sprint 9.2: Customer Automations
 *
 * ┌────────────────────────────┬──────────────────┬──────────────────────────┬──────────┐
 * │ Automation ID              │ Consumes         │ Produces                 │ Mutates  │
 * ├────────────────────────────┼──────────────────┼──────────────────────────┼──────────┤
 * │ BOOKING_REMINDER_24H       │ Booking.Created  │ ScheduledTask (24h)      │ Nothing  │
 * │ BOOKING_REMINDER_EXECUTE   │ ScheduledTask    │ NotificationQueue        │ Nothing  │
 * │ INVOICE_OVERDUE_SCAN       │ System.DailyScan │ NotificationQueue        │ Nothing  │
 * │ PAYMENT_RECEIPT            │ Payment.Received │ NotificationQueue        │ Nothing  │
 * └────────────────────────────┴──────────────────┴──────────────────────────┴──────────┘
 *
 * ORDERING GUARANTEE:
 * Node.js EventEmitter dispatches events synchronously in the order listeners were registered.
 * This means 'Booking.Created' will always fire and schedule its task BEFORE any subsequent
 * event on a different channel. For events on the same entity (e.g., Invoice.Issued →
 * Payment.Received), they are guaranteed to be sequential because the domain services
 * are called sequentially in Express request handlers — never concurrently.
 */

export const registerCustomerAutomations = () => {
  logger.info('[Automations] Registering Sprint 9.2 customer automation handlers...');

  // ────────────────────────────────────────────────────────────────────────────
  // 1. BOOKING REMINDER (24H)
  // Trigger: Immediately when a Booking is created
  // Action:  Schedule a ScheduledTask to fire 24 hours before the booking start
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('Booking.Created', async (payload: { booking_id: string; scheduled_date: Date }) => {
    const started_at = new Date();
    const action_taken = 'Scheduled 24h Booking Reminder';

    // Idempotency: Only schedule once per booking
    if (await hasExecutionSucceeded('Booking.Created', payload.booking_id, action_taken)) {
      logger.info(`[Automations] Skipping duplicate 24h reminder for booking ${payload.booking_id}`);
      return;
    }

    try {
      // 1. Immediate Booking Confirmation
      const booking = await prisma.booking.findUnique({
        where: { id: payload.booking_id },
        include: { customer: true }
      });

      if (booking && booking.customer?.phone) {
        await enqueueNotification({
          correlation_id: `BKG-CONF-${booking.id}-${Date.now()}`,
          recipient_type: 'Customer',
          recipient_id: booking.customer.phone,
          channel: 'WHATSAPP',
          template_code: 'BOOKING_CONFIRMED',
          payload_version: '1.0',
          payload: {
            customer_name: booking.customer.name,
            service_name: booking.service_name,
            scheduled_date: booking.scheduled_date
          }
        });
      }

      const reminderTime = subHours(new Date(payload.scheduled_date), 24);

      // Only schedule if the reminder time is in the future
      if (reminderTime <= new Date()) {
        logger.info(`[Automations] Booking ${payload.booking_id} is too soon for a 24h reminder — skipping.`);
        return;
      }

      const correlation_id = `BKG-REM-${payload.booking_id}-${Date.now()}`;
      await scheduleTask({
        task_name: 'BOOKING_REMINDER_24H',
        correlation_id,
        metadata: { booking_id: payload.booking_id, type: 'Booking' },
        payload: { booking_id: payload.booking_id },
        scheduled_for: reminderTime,
        priority: 'NORMAL',
        idempotency_key: `BOOKING_REMINDER_24H:${payload.booking_id}`
      });

      await logExecution({
        event_name: 'Booking.Created',
        reference_id: payload.booking_id,
        action_taken,
        status: 'SUCCESS',
        started_at,
        finished_at: new Date()
      });
    } catch (error: any) {
      logger.error('[Automations] Failed to schedule booking reminder:', error);
      await logExecution({
        event_name: 'Booking.Created',
        reference_id: payload.booking_id,
        action_taken,
        status: 'FAILED',
        error_message: error.message,
        started_at,
        finished_at: new Date()
      });
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. BOOKING REMINDER EXECUTION
  // Trigger: When CronSweeper fires a BOOKING_REMINDER_24H task
  // Action:  STATE VALIDATION → enqueue notification if booking is still active
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('ScheduledTask.BOOKING_REMINDER_24H', async (task: any) => {
    const started_at = new Date();
    const booking_id = task.payload?.booking_id;

    if (!booking_id) return;

    // STATE VALIDATION: Re-read from DB — never trust stale queued data
    const booking = await prisma.booking.findUnique({
      where: { id: booking_id },
      select: {
        id: true, status: true,
        customer_phone: true, customer_name: true,
        scheduled_date: true, service_name: true
      }
    });

    if (!booking) {
      logger.warn(`[Automations] Booking ${booking_id} no longer exists — skipping reminder.`);
      return;
    }

    // Validate booking is still active
    const activeStatuses = ['Pending', 'Confirmed', 'Scheduled', 'Assigned'];
    if (!activeStatuses.includes(booking.status)) {
      logger.info(`[Automations] Booking ${booking_id} is ${booking.status} — skipping reminder.`);
      return;
    }

    // Validate customer phone exists
    if (!booking.customer_phone) {
      logger.warn(`[Automations] Booking ${booking_id} has no customer phone — skipping reminder.`);
      return;
    }

    await enqueueNotification({
      correlation_id: task.correlation_id ?? undefined,
      recipient_type: 'Customer',
      recipient_id: booking.customer_phone,
      channel: 'WHATSAPP',
      template_code: 'BOOKING_REMINDER_24H',
      payload_version: '1.0',
      payload: {
        customer_name: booking.customer_name,
        service_name: booking.service_name,
        scheduled_date: booking.scheduled_date
      }
    });

    logger.info(`[Automations] 24h reminder queued for booking ${booking_id}`);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. INVOICE OVERDUE SCAN
  // Trigger: System.DailyScan (nightly cron)
  // Action:  Find all overdue invoices and enqueue reminder notifications
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('System.DailyScan', async () => {
    const started_at = new Date();
    logger.info('[Automations] Running invoice overdue scan...');

    try {
      // Re-read from DB — the only source of truth for overdue status
      const overdueInvoices = await prisma.invoice.findMany({
        where: {
          status: 'Issued',
          payment_status: { in: ['Unpaid', 'Partial'] },
          due_date: { lt: new Date() }
        },
        select: {
          id: true, invoice_number: true, due_date: true,
          balance_due: true, customer_phone: true, customer_name: true
        },
        take: 200 // Safety cap per scan
      });

      logger.info(`[Automations] Overdue scan found ${overdueInvoices.length} invoice(s).`);

      for (const invoice of overdueInvoices) {
        const action_taken = 'Queued overdue invoice reminder';

        // Idempotency: Only send one reminder per invoice per day
        const today = new Date().toISOString().split('T')[0];
        if (await hasExecutionSucceeded('System.DailyScan', `${invoice.id}:${today}`, action_taken)) {
          continue;
        }

        // STATE VALIDATION: Ensure balance_due is still positive (may have been paid since query)
        if (Number(invoice.balance_due) <= 0) continue;
        if (!invoice.customer_phone) continue;

        await enqueueNotification({
          correlation_id: `INV-OVD-${invoice.id}-${today}`,
          recipient_type: 'Customer',
          recipient_id: invoice.customer_phone,
          channel: 'WHATSAPP',
          template_code: 'INVOICE_OVERDUE_REMINDER',
          payload_version: '1.0',
          payload: {
            customer_name: invoice.customer_name,
            invoice_number: invoice.invoice_number,
            balance_due: invoice.balance_due,
            due_date: invoice.due_date
          }
        });

        await logExecution({
          event_name: 'System.DailyScan',
          reference_id: `${invoice.id}:${today}`,
          action_taken,
          status: 'SUCCESS',
          started_at,
          finished_at: new Date()
        });
      }
    } catch (error: any) {
      logger.error('[Automations] Invoice overdue scan failed:', error);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. PAYMENT RECEIPT
  // Trigger: Payment.Received (emitted by PaymentService after recording a payment)
  // Action:  STATE VALIDATION → enqueue payment receipt notification
  // ────────────────────────────────────────────────────────────────────────────
  eventBus.subscribe('Payment.Received', async (payload: { payment_id: string }) => {
    const started_at = new Date();
    const action_taken = 'Queued payment receipt notification';

    if (await hasExecutionSucceeded('Payment.Received', payload.payment_id, action_taken)) {
      logger.info(`[Automations] Skipping duplicate receipt for payment ${payload.payment_id}`);
      return;
    }

    try {
      // STATE VALIDATION: Re-read payment with invoice context
      const payment = await prisma.payment.findUnique({
        where: { id: payload.payment_id },
        select: {
          id: true, payment_number: true, amount: true, payment_status: true,
          customer: { select: { phone: true, name: true } },
          invoice: { select: { invoice_number: true, balance_due: true } }
        }
      });

      if (!payment) {
        logger.warn(`[Automations] Payment ${payload.payment_id} not found — skipping receipt.`);
        return;
      }

      if (payment.payment_status !== 'Completed') {
        logger.info(`[Automations] Payment ${payload.payment_id} is ${payment.payment_status} — skipping receipt.`);
        return;
      }

      if (!payment.customer?.phone) {
        logger.warn(`[Automations] Payment ${payload.payment_id} has no customer phone — skipping receipt.`);
        return;
      }

      await enqueueNotification({
        correlation_id: `RCPT-${payment.id}`,
        recipient_type: 'Customer',
        recipient_id: payment.customer.phone,
        channel: 'WHATSAPP',
        template_code: 'PAYMENT_RECEIPT',
        payload_version: '1.0',
        payload: {
          customer_name: payment.customer.name,
          payment_number: payment.payment_number,
          amount: payment.amount,
          invoice_number: payment.invoice.invoice_number,
          balance_due: payment.invoice.balance_due
        }
      });

      await logExecution({
        event_name: 'Payment.Received',
        reference_id: payload.payment_id,
        action_taken,
        status: 'SUCCESS',
        started_at,
        finished_at: new Date()
      });
    } catch (error: any) {
      logger.error('[Automations] Failed to queue payment receipt:', error);
      await logExecution({
        event_name: 'Payment.Received',
        reference_id: payload.payment_id,
        action_taken,
        status: 'FAILED',
        error_message: error.message,
        started_at,
        finished_at: new Date()
      });
    }
  });

  logger.info('[Automations] Sprint 9.2 customer automations registered.');
};
