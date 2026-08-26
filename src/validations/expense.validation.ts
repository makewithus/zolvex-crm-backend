import Joi from 'joi';

// ─── Create ───────────────────────────────────────────────────────────────────
export const createExpenseSchema = Joi.object({
  category:     Joi.string().valid('Supplies', 'Travel', 'Salaries', 'Marketing', 'Utilities', 'Maintenance', 'Other').required(),
  amount:       Joi.number().positive().precision(2).required(),
  expense_date: Joi.date().iso().required(),
  description:  Joi.string().min(2).max(1000).required(),
  vendor_name:  Joi.string().max(200).optional().allow('', null),
  city_id:      Joi.string().uuid().optional().allow(null),
});

// ─── Update (Draft only) ──────────────────────────────────────────────────────
export const updateExpenseSchema = Joi.object({
  category:     Joi.string().valid('Supplies', 'Travel', 'Salaries', 'Marketing', 'Utilities', 'Maintenance', 'Other').optional(),
  amount:       Joi.number().positive().precision(2).optional(),
  expense_date: Joi.date().iso().optional(),
  description:  Joi.string().min(2).max(1000).optional(),
  vendor_name:  Joi.string().max(200).optional().allow('', null),
  city_id:      Joi.string().uuid().optional().allow(null),
});

// ─── Reject (requires reason) ────────────────────────────────────────────────
export const rejectExpenseSchema = Joi.object({
  reason: Joi.string().min(3).max(500).required(),
});
