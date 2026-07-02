import { z } from 'zod';

export const updateUserSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid user ID format') }),
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(10).optional(),
    role_id: z.string().uuid().optional(),
    city_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
    skill_tags: z.array(z.string()).optional(),
  }).strict()
});

export const resetPasswordSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid user ID format') }),
  body: z.object({
    new_password: z.string().min(6, 'Password must be at least 6 characters')
  }).strict()
});
