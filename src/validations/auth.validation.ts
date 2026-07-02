import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    phone: z.string().min(1, 'Phone is required'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
  }),
});
