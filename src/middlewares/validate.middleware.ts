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
      if (validated.body !== undefined) {
        req.body = validated.body;
      }
      if (validated.query !== undefined) {
        Object.defineProperty(req, 'query', {
          value: validated.query,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      if (validated.params !== undefined) {
        req.params = validated.params as any;
      }
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return sendError(res, 400, 'Validation failed', error.issues);
      }
      return next(error);
    }
  };
};
