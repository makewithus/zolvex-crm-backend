import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    phone: z.string().regex(/^\d{10,}$/, 'Phone must be at least 10 digits'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});
