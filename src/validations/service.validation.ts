import { z } from 'zod';

export const createServiceSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    base_price: z.number().min(0, 'Base price must be >= 0'),
    is_active: z.boolean().optional(),
  }),
});

export const updateServiceSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid service ID format') }),
  body: z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),
    description: z.string().optional(),
    base_price: z.number().min(0, 'Base price must be >= 0').optional(),
    is_active: z.boolean().optional(),
  }).strict()
});
