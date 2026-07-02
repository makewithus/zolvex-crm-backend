import { z } from 'zod';

export const createPricingRuleSchema = z.object({
  body: z.object({
    service_id: z.string().uuid('Valid Service ID required'),
    city_id: z.string().uuid('Valid City ID required').optional().nullable(),
    bhk_type: z.string().optional().nullable(),
    tank_size: z.string().optional().nullable(),
    base_price: z.number().min(0, 'Base price must be >= 0'),
  }),
});

export const updatePricingRuleSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid pricing rule ID format') }),
  body: z.object({
    base_price: z.number().min(0, 'Base price must be >= 0').optional(),
    bhk_type: z.string().nullable().optional(),
    tank_size: z.string().nullable().optional(),
    city_id: z.string().uuid().nullable().optional(),
  }).strict()
});

export const deletePricingRuleSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid pricing rule ID format') }),
});
