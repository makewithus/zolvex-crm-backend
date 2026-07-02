import { z } from 'zod';

export const createLostReasonSchema = z.object({
  body: z.object({
    reason_text: z.string().min(1, 'Reason text required'),
  }),
});
