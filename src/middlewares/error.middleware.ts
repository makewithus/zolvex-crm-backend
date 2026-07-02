import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { AppError } from '../utils/AppError';
import { sendError } from '../utils/response.util';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    logger.info(`[${err.statusCode}] ${err.message}`);
    return sendError(res, err.statusCode, err.message);
  }

  logger.error(err.message, err.stack);
  return sendError(res, err.status || 500, err.message || 'Internal Server Error');
};
