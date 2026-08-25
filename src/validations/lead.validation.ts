import { z } from 'zod';

export const createLeadSchema = z.object({
  body: z.object({
    phone: z.string().regex(/^\d{10,}$/, 'Phone must be at least 10 digits'),
    name: z.string().optional().nullable(),
    source: z.enum(['Phone', 'WhatsApp', 'WebsiteForm', 'MetaAds', 'ManualEntry', 'Justdial', 'Referrals']),
    city_id: z.string().uuid().optional().nullable(),
    service_id: z.string().uuid().optional().nullable(),
    service_location: z.string().optional().nullable(),
    follow_up_date: z.string().datetime().optional().nullable(),
  }),
});

export const updateLeadSchema = z.object({
  body: z.object({
    name: z.string().optional().nullable(),
    city_id: z.string().uuid().optional().nullable(),
    service_id: z.string().uuid().optional().nullable(),
    status: z.enum(['New', 'Contacted', 'FollowUp', 'Qualified', 'QuotationSent', 'Booked', 'Lost']).optional(),
    assigned_to: z.string().uuid().optional().nullable(),
    lost_reason_id: z.string().uuid().optional().nullable(),
    service_location: z.string().optional().nullable(),
    follow_up_date: z.string().datetime().optional().nullable(),
  }),
});

export const createLeadNoteSchema = z.object({
  body: z.object({
    note_text: z.string().min(1, 'Note text required'),
  }),
});
