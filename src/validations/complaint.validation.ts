import Joi from 'joi';
import { ComplaintPriority } from '@prisma/client';

export const createComplaintSchema = Joi.object({
  customer_id: Joi.string().uuid().required(),
  booking_id: Joi.string().uuid().optional(),
  job_id: Joi.string().uuid().optional(),
  invoice_id: Joi.string().uuid().optional(),
  subject: Joi.string().max(255).required(),
  description: Joi.string().required(),
  priority: Joi.string().valid(...Object.values(ComplaintPriority)).optional(),
});

export const assignComplaintSchema = Joi.object({
  assigned_to: Joi.string().uuid().required(),
  note: Joi.string().optional(),
});

export const resolveComplaintSchema = Joi.object({
  resolution_note: Joi.string().required(),
});

export const escalateComplaintSchema = Joi.object({
  reason: Joi.string().required(),
});

export const closeComplaintSchema = Joi.object({
  note: Joi.string().optional(),
});
