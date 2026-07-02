import { z } from 'zod';

export const updateCitySchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid city ID format') }),
  body: z.object({
    name: z.string().min(1, 'Name cannot be empty').optional(),
    is_active: z.boolean().optional(),
  }).strict()
});
