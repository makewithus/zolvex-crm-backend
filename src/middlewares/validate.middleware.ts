import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { sendError } from '../utils/response.util';

export const validateRequest = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      }) as any;
      req.body = validated.body;
      req.query = validated.query;
      req.params = validated.params as any;
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, 'Validation failed', error.issues);
      }
      return next(error);
    }
  };
};
