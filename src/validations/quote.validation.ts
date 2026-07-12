import Joi from 'joi';

// ─── Create ───────────────────────────────────────────────────────────────────
export const createQuoteSchema = Joi.object({
  customer_id: Joi.string().uuid().required(),
  lead_id:     Joi.string().uuid().optional(),
  subject:     Joi.string().min(3).max(200).required(),
  description: Joi.string().max(2000).optional(),
  valid_until: Joi.date().iso().optional(),
  notes:       Joi.string().max(2000).optional(),
  terms:       Joi.string().max(5000).optional(),
  line_items:  Joi.array().items(
    Joi.object({
      service_id:  Joi.string().uuid().optional(),
      description: Joi.string().min(1).max(500).required(),
      quantity:    Joi.number().integer().min(1).required(),
      unit_price:  Joi.number().min(0).required(),
      tax_percent: Joi.number().min(0).max(100).default(18),
      sort_order:  Joi.number().integer().min(0).default(0),
    })
  ).min(1).required(),
});

// ─── Update (Draft edits only) ────────────────────────────────────────────────
export const updateQuoteSchema = Joi.object({
  subject:     Joi.string().min(3).max(200).optional(),
  description: Joi.string().max(2000).optional(),
  valid_until: Joi.date().iso().optional(),
  notes:       Joi.string().max(2000).optional(),
  terms:       Joi.string().max(5000).optional(),
  line_items:  Joi.array().items(
    Joi.object({
      service_id:  Joi.string().uuid().optional(),
      description: Joi.string().min(1).max(500).required(),
      quantity:    Joi.number().integer().min(1).required(),
      unit_price:  Joi.number().min(0).required(),
      tax_percent: Joi.number().min(0).max(100).default(18),
      sort_order:  Joi.number().integer().min(0).default(0),
    })
  ).min(1).optional(),
});

// ─── Send (Draft → Sent) ──────────────────────────────────────────────────────
export const sendQuoteSchema = Joi.object({
  note: Joi.string().max(500).optional(),
});

// ─── Reject ───────────────────────────────────────────────────────────────────
export const rejectQuoteSchema = Joi.object({
  reason: Joi.string().min(3).max(500).required(),
});

// ─── Accept (customer-side — no booking conversion here, pending decision) ────
export const acceptQuoteSchema = Joi.object({
  note: Joi.string().max(500).optional(),
});
