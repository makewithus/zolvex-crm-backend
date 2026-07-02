import { z } from 'zod';

export const createServiceSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required'),
    description: z.string().optional(),
    base_price: z.number().min(0, 'Base price must be >= 0'),
    is_active: z.boolean().optional(),
  }),
});
