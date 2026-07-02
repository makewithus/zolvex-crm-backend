import { Response } from 'express';

export const sendSuccess = (res: Response, statusCode: number, message: string, data?: any) => {
  res.status(statusCode).json({
    status: 'success',
    message,
    data,
  });
};

export const sendError = (res: Response, statusCode: number, message: string, errors?: any) => {
  res.status(statusCode).json({
    status: 'error',
    message,
    errors,
  });
};
