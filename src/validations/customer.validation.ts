import { z } from 'zod';

export const updateCustomerSchema = z.object({
  body: z.object({
    name: z.string().optional().nullable(),
    is_repeat_customer: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
  }),
});
