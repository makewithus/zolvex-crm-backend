import { z } from 'zod';

export const createLeadSchema = z.object({
  body: z.object({
    phone: z.string().min(10, 'Valid phone required'),
    name: z.string().optional().nullable(),
    source: z.enum(['Phone', 'WhatsApp', 'WebsiteForm', 'MetaAds', 'ManualEntry', 'Justdial', 'Referrals']),
    city_id: z.string().uuid().optional().nullable(),
    service_id: z.string().uuid().optional().nullable(),
  }),
});

export const updateLeadSchema = z.object({
  body: z.object({
    status: z.enum(['New', 'Contacted', 'FollowUp', 'Qualified', 'QuotationSent', 'Booked', 'Lost']).optional(),
    assigned_to: z.string().uuid().optional().nullable(),
    lost_reason_id: z.string().uuid().optional().nullable(),
  }),
});

export const createLeadNoteSchema = z.object({
  body: z.object({
    note_text: z.string().min(1, 'Note text required'),
  }),
});
