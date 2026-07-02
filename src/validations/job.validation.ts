import { z } from 'zod';

export const createJobFromBookingSchema = z.object({
  body: z.object({
    priority: z.enum(['Low', 'Normal', 'High', 'Urgent']).optional(),
  })
});

export const updateJobStatusSchema = z.object({
  body: z.object({
    status: z.enum([
      'Pending', 'Assigned', 'Accepted', 'Travelling', 'Arrived', 
      'Started', 'Completed', 'Cancelled', 'Failed', 'NoAccess', 
      'CustomerNotAvailable', 'Rescheduled'
    ]),
    failureReason: z.enum([
      'NO_ACCESS', 'CUSTOMER_ABSENT', 'MATERIAL_MISSING', 
      'WEATHER', 'TECHNICAL_FAILURE', 'OTHER'
    ]).optional(),
    cancellationReason: z.string().optional(),
    completionNotes: z.string().optional(),
  })
});

export const assignJobSchema = z.object({
  body: z.object({
    assigned_user_id: z.string().uuid(),
  })
});

export const rescheduleJobSchema = z.object({
  body: z.object({
    new_scheduled_start: z.string().datetime(),
  })
});
