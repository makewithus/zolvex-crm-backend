import { z } from 'zod';

export const createPaymentSchema = z.object({
  body: z.object({
    invoice_id: z.string().uuid('Valid Invoice ID is required'),
    amount: z.number().positive('Payment amount must be greater than zero'),
    payment_method: z.enum(['Cash', 'UPI', 'BankTransfer', 'Card', 'Cheque']),
    payment_date: z.string().optional(), // ISO date string; defaults to now() in service
    payment_metadata: z.any().optional().nullable(),
    notes: z.string().optional(),
    reason: z.string().optional() // For audit logs
  })
});

export const getPaymentsSchema = z.object({
  query: z.object({
    invoice_id: z.string().uuid('Valid Invoice ID is required').optional(),
    customer_id: z.string().uuid('Valid Customer ID is required').optional()
  })
});
