import { Request, Response, NextFunction } from 'express';
import { PrismaClient, ThreadStatus } from '@prisma/client';
import * as whatsappService from '../services/whatsapp.service';
import { AppError } from '../utils/AppError';
import axios from 'axios';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

/**
 * GET /api/v1/whatsapp/threads
 * Lists all conversation threads with optional filters.
 */
export const getThreads = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = typeof req.query.status === 'string'
      ? req.query.status as ThreadStatus
      : undefined;
    const assigned_to = typeof req.query.assigned_to === 'string'
      ? req.query.assigned_to
      : undefined;
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page) : 1;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit) : 20;

    const result = await whatsappService.getThreads({ status, assigned_to, page, limit });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/whatsapp/threads/:id/messages
 * Returns paginated message history for a thread (soft-deleted excluded).
 */
export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threadId = req.params.id as string;
    const page = typeof req.query.page === 'string' ? parseInt(req.query.page) : 1;
    const result = await whatsappService.getMessages(threadId, page);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/v1/whatsapp/threads/:id/send
 * Sends an outbound WhatsApp message from an agent via Meta Cloud API.
 */
export const sendMessage = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threadId = req.params.id as string;
    const { body } = req.body;
    const agent = (req as any).user;

    if (!body || typeof body !== 'string' || body.trim() === '') {
      return next(new AppError('Message body is required', 400));
    }

    const thread = await prisma.whatsAppThread.findUnique({ where: { id: threadId } });
    if (!thread) return next(new AppError('Thread not found', 404));

    const accessToken = process.env.META_ACCESS_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
    const apiBase = process.env.META_WHATSAPP_API || 'https://graph.facebook.com/v18.0';

    if (!accessToken || !phoneNumberId) {
      return next(new AppError('WhatsApp API credentials not configured', 500));
    }

    // Send via Meta Cloud API
    const metaResponse = await axios.post(
      `${apiBase}/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: thread.customer_phone.replace('+', ''),
        type: 'text',
        text: { body: body.trim() }
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const meta_message_id: string | undefined = metaResponse.data?.messages?.[0]?.id;
    const message = await whatsappService.saveOutboundMessage(threadId, body.trim(), agent.id);
    logger.info(`[WhatsAppInbox] Agent ${agent.id} sent message to thread ${threadId}`);

    res.json({ success: true, message, meta_message_id });
  } catch (error: any) {
    logger.error(`[WhatsAppInbox] Failed to send message: ${error.message}`);
    next(error);
  }
};

/**
 * PATCH /api/v1/whatsapp/threads/:id/assign
 * Assigns a thread to an agent and sets status to ASSIGNED.
 */
export const assignThread = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threadId = req.params.id as string;
    const { user_id } = req.body;
    if (!user_id || typeof user_id !== 'string') {
      return next(new AppError('user_id is required', 400));
    }
    const thread = await whatsappService.assignThread(threadId, user_id);
    res.json({ success: true, thread });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/whatsapp/threads/:id/resolve
 * Marks a thread as RESOLVED.
 */
export const resolveThread = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threadId = req.params.id as string;
    const thread = await whatsappService.resolveThread(threadId);
    res.json({ success: true, thread });
  } catch (error) {
    next(error);
  }
};
