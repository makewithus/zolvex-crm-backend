import { PrismaClient, ThreadStatus, MessageDirection, MessageStatus } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * WhatsApp Inbox Service
 * Isolated module — no existing CRM services or workflows are imported or modified.
 */

/**
 * Finds the customer_id from the Customer table using phone number.
 * Returns null if no customer exists yet (lead may not be created yet).
 */
const resolveCustomerId = async (phone: string): Promise<string | null> => {
  const customer = await prisma.customer.findFirst({
    where: { phone },
    select: { id: true }
  });
  return customer?.id ?? null;
};

/**
 * Gets an existing open/assigned thread by customer_id (preferred) or phone (fallback).
 * Auto-reopens a RESOLVED thread if a new inbound message arrives.
 */
export const getOrCreateThread = async (phone: string, name: string) => {
  const customer_id = await resolveCustomerId(phone);

  // Try to find an existing thread — prefer customer_id lookup, fall back to phone snapshot
  let thread = customer_id
    ? await prisma.whatsAppThread.findFirst({
        where: { customer_id },
        orderBy: { last_message_at: 'desc' }
      })
    : await prisma.whatsAppThread.findFirst({
        where: { customer_phone: phone },
        orderBy: { last_message_at: 'desc' }
      });

  if (thread) {
    // Auto-reopen resolved threads when a new message arrives (Zendesk/Freshdesk behavior)
    if (thread.status === ThreadStatus.RESOLVED) {
      thread = await prisma.whatsAppThread.update({
        where: { id: thread.id },
        data: { status: ThreadStatus.OPEN, last_message_at: new Date() }
      });
      logger.info(`[WhatsAppService] Thread ${thread.id} re-opened on new inbound message.`);
    }
    return thread;
  }

  // Create a new thread
  thread = await prisma.whatsAppThread.create({
    data: {
      customer_phone: phone,
      customer_id,
      status: ThreadStatus.OPEN,
      last_message_at: new Date()
    }
  });
  logger.info(`[WhatsAppService] New thread created: ${thread.id} for ${phone}`);
  return thread;
};

/**
 * Saves an inbound WhatsApp message to the thread.
 * Increments unread_count and updates last_message_at.
 */
export const saveInboundMessage = async (
  thread_id: string,
  body: string,
  meta_message_id?: string
) => {
  const [message] = await prisma.$transaction([
    prisma.whatsAppMessage.create({
      data: {
        thread_id,
        direction: MessageDirection.INBOUND,
        body,
        status: MessageStatus.SENT,
        meta_message_id: meta_message_id ?? null
      }
    }),
    prisma.whatsAppThread.update({
      where: { id: thread_id },
      data: {
        unread_count: { increment: 1 },
        last_message_at: new Date()
      }
    })
  ]);
  return message;
};

/**
 * Saves an outbound WhatsApp message sent by an agent.
 * Resets unread_count to 0 (agent has seen the conversation).
 */
export const saveOutboundMessage = async (
  thread_id: string,
  body: string,
  sent_by: string
) => {
  const [message] = await prisma.$transaction([
    prisma.whatsAppMessage.create({
      data: {
        thread_id,
        direction: MessageDirection.OUTBOUND,
        body,
        status: MessageStatus.SENT,
        sent_by
      }
    }),
    prisma.whatsAppThread.update({
      where: { id: thread_id },
      data: {
        unread_count: 0,
        last_message_at: new Date()
      }
    })
  ]);
  return message;
};

/**
 * Updates the delivery/read status of a message by Meta's wamid.
 * Completely isolated — does not affect lead creation or any automation.
 */
export const updateMessageStatus = async (
  meta_message_id: string,
  status: string
) => {
  const statusMap: Record<string, MessageStatus> = {
    sent: MessageStatus.SENT,
    delivered: MessageStatus.DELIVERED,
    read: MessageStatus.READ,
    failed: MessageStatus.FAILED
  };
  const mappedStatus = statusMap[status];
  if (!mappedStatus) return; // Ignore unknown statuses

  await prisma.whatsAppMessage.updateMany({
    where: { meta_message_id },
    data: { status: mappedStatus }
  });
};

/**
 * Returns paginated threads for the inbox.
 * Supports filtering by status and assigned_to.
 */
export const getThreads = async (filters: {
  status?: ThreadStatus;
  assigned_to?: string;
  page?: number;
  limit?: number;
}) => {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.assigned_to) where.assigned_to = filters.assigned_to;

  const [threads, total] = await prisma.$transaction([
    prisma.whatsAppThread.findMany({
      where,
      orderBy: { last_message_at: 'desc' },
      skip,
      take: limit
    }),
    prisma.whatsAppThread.count({ where })
  ]);

  return { threads, total, page, limit };
};

/**
 * Returns paginated message history for a thread.
 * Excludes soft-deleted messages.
 */
export const getMessages = async (thread_id: string, page = 1, limit = 50) => {
  const skip = (page - 1) * limit;

  const [messages, total] = await prisma.$transaction([
    prisma.whatsAppMessage.findMany({
      where: { thread_id, deleted_at: null },
      orderBy: { created_at: 'asc' },
      skip,
      take: limit
    }),
    prisma.whatsAppMessage.count({
      where: { thread_id, deleted_at: null }
    })
  ]);

  return { messages, total, page, limit };
};

/**
 * Assigns a thread to an agent and sets status to ASSIGNED.
 */
export const assignThread = async (thread_id: string, user_id: string) => {
  return prisma.whatsAppThread.update({
    where: { id: thread_id },
    data: { assigned_to: user_id, status: ThreadStatus.ASSIGNED }
  });
};

/**
 * Marks a thread as RESOLVED.
 */
export const resolveThread = async (thread_id: string) => {
  return prisma.whatsAppThread.update({
    where: { id: thread_id },
    data: { status: ThreadStatus.RESOLVED }
  });
};
