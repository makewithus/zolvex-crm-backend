import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/response.util';
import { Prisma } from '@prisma/client';

// Human-readable field name mapping for unique constraint violations
const UNIQUE_FIELD_MESSAGES: Record<string, string> = {
  phone: 'A user with this phone number already exists.',
  email: 'A record with this email already exists.',
  name: 'A record with this name already exists.',
};

function getPrismaUniqueMessage(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    for (const field of target) {
      if (UNIQUE_FIELD_MESSAGES[field]) return UNIQUE_FIELD_MESSAGES[field];
    }
    return `A record with this ${target.join(', ')} already exists.`;
  }
  return 'A record with these details already exists.';
}

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    logger.info(`[${err.statusCode}] ${err.message}`);
    return sendError(res, err.statusCode, err.message);
  }

  // Handle Prisma unique constraint violations (P2002)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const message = getPrismaUniqueMessage(err);
      logger.info(`[409] Prisma P2002: ${message}`);
      return sendError(res, 409, message);
    }
    if (err.code === 'P2025') {
      logger.info(`[404] Prisma P2025: Record not found`);
      return sendError(res, 404, 'Record not found.');
    }
  }

  logger.error(err.message, err.stack);
  return sendError(res, err.status || 500, 'An unexpected error occurred. Please try again.');
};
