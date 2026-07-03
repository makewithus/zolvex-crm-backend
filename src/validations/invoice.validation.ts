import { z } from 'zod';

export const createInvoiceFromBookingSchema = z.object({
  body: z.object({
    // Only required if manually passing overrides for dates or generation mode
    issue_date: z.string().datetime().optional(),
    due_date: z.string().datetime().optional(),
  })
});

export const updateInvoiceStatusSchema = z.object({
  body: z.object({
    status: z.enum(['Issued', 'Cancelled']),
    reason: z.string().optional()
  })
});
