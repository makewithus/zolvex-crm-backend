import { z } from 'zod';

export const createUserSchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    phone: z.string().regex(/^\d{10,}$/, 'Phone must be at least 10 digits'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    role_id: z.string().uuid('Invalid role ID'),
    // Empty string → null so the FK is never violated
    city_id: z.string().transform(v => v === '' ? null : v).nullable().optional(),
  })
});

export const updateUserSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid user ID format') }),
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().regex(/^\d{10,}$/, 'Phone must be at least 10 digits').optional(),
    role_id: z.string().uuid().optional(),
    city_id: z.string().uuid().nullable().optional().transform(v => (v === '' ? null : v ?? null)),
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

