import { z } from 'zod';

export const getBookingsSchema = z.object({
  query: z.object({
    status: z.enum(['Draft', 'Pending', 'Confirmed', 'Scheduled', 'Assigned', 'InProgress', 'Completed', 'Cancelled', 'NoShow']).optional(),
    city_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    service_id: z.string().uuid().optional(),
    assigned_user_id: z.string().uuid().optional(),
    booking_id: z.string().optional(),
    page: z.string().regex(/^\d+$/).transform(Number).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  })
});

export const createBookingSchema = z.object({
  body: z.object({
    customer_id: z.string().uuid(),
    city_id: z.string().uuid(),
    service_id: z.string().uuid(),
    scheduled_date: z.string().datetime(),
    slot: z.string().nullable().optional(),
    
    address_line_1: z.string().min(1),
    address_line_2: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    landmark: z.string().nullable().optional(),
    city_name: z.string().min(1),
    postal_code: z.string().min(1),
    state: z.string().min(1),
    country: z.string().default('India'),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    
    notes: z.string().nullable().optional(),
    special_instructions: z.string().nullable().optional(),
  })
});

export const updateBookingSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    notes: z.string().nullable().optional(),
    special_instructions: z.string().nullable().optional(),
  })
});

export const updateBookingStatusSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    status: z.enum(['Pending', 'Confirmed', 'Scheduled', 'Assigned', 'InProgress', 'Completed', 'Cancelled', 'NoShow'])
  })
});

export const rescheduleBookingSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    scheduled_date: z.string().datetime(),
    slot: z.string().nullable().optional(),
  })
});

export const cancelBookingSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    cancel_reason: z.string().min(1),
  })
});

export const convertLeadToBookingSchema = z.object({
  params: z.object({ leadId: z.string().uuid() }),
  body: z.object({
    scheduled_date: z.string().datetime(),
    slot: z.string().nullable().optional(),
    address_line_1: z.string().min(1),
    address_line_2: z.string().nullable().optional(),
    area: z.string().nullable().optional(),
    landmark: z.string().nullable().optional(),
    city_name: z.string().min(1),
    postal_code: z.string().min(1),
    state: z.string().min(1),
    country: z.string().default('India'),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    notes: z.string().nullable().optional(),
    special_instructions: z.string().nullable().optional(),
  })
});
