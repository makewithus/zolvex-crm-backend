import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { BUSINESS_HOURS } from '../config/business-hours';
import { checkAvailability } from './technician-availability.service';
import { eventBus } from '../events/eventBus';
import { calculateGST } from '../utils/gst.util';
import { getCompanyRegisteredState } from './settings.service';

const prisma = new PrismaClient();

function validateSlot(slot?: string) {
  if (!slot) return;
  const [h, m] = slot.split(':').map(Number);
  const totalMinutes = h * 60 + m;
  const start = BUSINESS_HOURS.START_HOUR * 60;
  const end = BUSINESS_HOURS.END_HOUR * 60;
  if (totalMinutes < start || totalMinutes > end) {
    throw new AppError(`Time slot must be between ${BUSINESS_HOURS.START_HOUR}:00 and ${BUSINESS_HOURS.END_HOUR}:00 (business hours)`, 400);
  }
}

// Helper to generate a sequential Booking ID using a transaction
async function generateBookingId(tx: Prisma.TransactionClient): Promise<string> {
  const sequence = await tx.bookingSequence.update({
    where: { id: 1 },
    data: { value: { increment: 1 } },
  });
  return `BKG-${sequence.value.toString().padStart(6, '0')}`;
}

// Ensure the sequence exists
async function ensureSequenceExists() {
  const seq = await prisma.bookingSequence.findUnique({ where: { id: 1 } });
  if (!seq) {
    await prisma.bookingSequence.create({ data: { id: 1, value: 0 } });
  }
}

// Call this once on startup or when the first booking is created
ensureSequenceExists().catch(console.error);

export const getBookings = async (filters: any) => {
  const { status, city_id, customer_id, service_id, assigned_user_id, booking_id, page, limit } = filters;
  const where: Prisma.BookingWhereInput = {};

  if (status) where.status = status;
  if (city_id) where.city_id = city_id;
  if (customer_id) where.customer_id = customer_id;
  if (service_id) where.service_id = service_id;
  if (assigned_user_id) where.assigned_user_id = assigned_user_id;
  if (booking_id) where.booking_id = { contains: booking_id, mode: 'insensitive' };

  const skip = (page - 1) * limit;

  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
      include: {
        customer: true,
        service: true,
        city: true,
        assignedUser: { select: { id: true, name: true } }
      }
    }),
    prisma.booking.count({ where })
  ]);

  return { bookings, total, page, limit };
};

export const getBookingById = async (id: string) => {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      customer: true,
      service: true,
      city: true,
      assignedUser: { select: { id: true, name: true } },
      history: { orderBy: { changed_at: 'desc' } }
    }
  });

  if (!booking) throw new AppError('Booking not found', 404);
  return booking;
};

// Core atomic conversion logic
export const convertLeadToBooking = async (leadId: string, bookingData: any, userId: string) => {
  validateSlot(bookingData.slot);

  // Pre-fetch global setting outside of the transaction to avoid connection pool deadlocks
  const companyState = await getCompanyRegisteredState();

  const booking = await prisma.$transaction(async (tx) => {
    // 1. Verify Lead
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      include: { customer: true, city: true, service: true }
    });

    if (!lead) throw new AppError('Lead not found', 404);
    if (lead.status === 'Booked') throw new AppError('Lead is already booked', 400);
    if (lead.status === 'Lost') throw new AppError('Cannot convert a lost lead', 400);
    if (!lead.service_id) throw new AppError('Please edit the Lead and assign a Service before converting to a Booking.', 400);
    if (!lead.city_id) throw new AppError('Please edit the Lead and assign a City before converting to a Booking.', 400);
    
    // Check for existing booking on this lead
    const existingBooking = await tx.booking.findUnique({ where: { lead_id: leadId } });
    if (existingBooking) throw new AppError('A booking already exists for this lead', 400);

    // 2. Verify Pricing Rule
    const pricingRule = await tx.pricingRule.findFirst({
      where: {
        service_id: lead.service_id!,
        OR: [
          { city_id: lead.city_id },
          { city_id: null }
        ]
      },
      orderBy: { city_id: 'desc' } // Prioritize city-specific rules
    });

    if (!pricingRule) {
      throw new AppError('No applicable pricing rule found for this service/city. Cannot convert to booking.', 400);
    }

    // 3. Prevent Duplicate Booking (Same customer, same service, same date)
    const startOfDay = new Date(bookingData.scheduled_date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const duplicateCheck = await tx.booking.findFirst({
      where: {
        customer_id: lead.customer_id,
        service_id: lead.service_id!,
        status: { not: 'Cancelled' },
        scheduled_date: {
          gte: startOfDay,
          lt: endOfDay
        }
      }
    });

    if (duplicateCheck) {
      throw new AppError('A booking for this customer and service already exists on the same day.', 400);
    }

    // 4. Generate Booking ID
    const booking_id = await generateBookingId(tx);

    // 5. Pre-compute GST
    if (!(lead.city as any)?.state) {
      throw new AppError("The selected city has no state configured. Please configure the city before creating bookings.", 400);
    }
    const bookingState = (lead.city as any).state;
    const gst1 = calculateGST(
      Number(pricingRule.base_price),
      Number(pricingRule.cgst_percent),
      Number(pricingRule.sgst_percent),
      Number(pricingRule.igst_percent),
      bookingState,
      companyState
    );

    // 6. Create Booking
    const booking = await tx.booking.create({
      data: {
        booking_id,
        lead_id: lead.id,
        customer_id: lead.customer_id,
        city_id: lead.city_id!,
        service_id: lead.service_id!,
        pricing_rule_id: pricingRule.id,
        scheduled_date: new Date(bookingData.scheduled_date),
        slot: bookingData.slot,
        
        customer_name: lead.customer.name,
        customer_phone: lead.customer.phone,
        
        address_line_1: bookingData.address_line_1,
        address_line_2: bookingData.address_line_2,
        area: bookingData.area,
        landmark: bookingData.landmark,
        city_name: bookingData.city_name,
        postal_code: bookingData.postal_code,
        state: bookingState,
        country: bookingData.country,
        latitude: bookingData.latitude,
        longitude: bookingData.longitude,
        
        service_name: lead.service!.name,
        
        base_price: pricingRule.base_price,
        discount: 0,
        cgst_percent: gst1.cgst_percent,
        cgst_amount: gst1.cgst_amount,
        sgst_percent: gst1.sgst_percent,
        sgst_amount: gst1.sgst_amount,
        igst_percent: gst1.igst_percent,
        igst_amount: gst1.igst_amount,
        tax: gst1.total_tax,
        final_amount: pricingRule.base_price + gst1.total_tax,
        
        notes: bookingData.notes,
        special_instructions: bookingData.special_instructions,
        
        created_by: userId,
        status: 'Pending',
      }
    });

    // 6. Update Lead Status
    await tx.lead.update({
      where: { id: lead.id },
      data: { status: 'Booked' }
    });

    // Add Lead History
    await tx.leadHistory.create({
      data: {
        lead_id: lead.id,
        from_stage: lead.status,
        to_stage: 'Booked',
        changed_by: userId
      }
    });

    return booking;
  }, {
    maxWait: 5000,
    timeout: 15000
  });
  // Publish AFTER the transaction commits — handler sees consistent DB state
  eventBus.publish('Booking.Created', { booking_id: booking.id, scheduled_date: booking.scheduled_date });
  return booking;
};

export const createBooking = async (data: any, userId: string) => {
  validateSlot(data.slot);

  // Pre-fetch global setting outside of the transaction to avoid connection pool deadlocks
  const companyState = await getCompanyRegisteredState();

  const booking = await prisma.$transaction(async (tx) => {
    // 1. Verify Customer, Service, City
    const [customer, service, city] = await Promise.all([
      tx.customer.findUnique({ where: { id: data.customer_id } }),
      tx.service.findUnique({ where: { id: data.service_id } }),
      tx.city.findUnique({ where: { id: data.city_id } })
    ]);

    if (!customer) throw new AppError('Customer not found', 404);
    if (!service) throw new AppError('Service not found', 404);
    if (!city) throw new AppError('City not found', 404);

    // 2. Verify Pricing Rule
    const pricingRule = await tx.pricingRule.findFirst({
      where: {
        service_id: service.id,
        OR: [
          { city_id: city.id },
          { city_id: null }
        ]
      },
      orderBy: { city_id: 'desc' }
    });

    if (!pricingRule) throw new AppError('No applicable pricing rule found', 400);

    // 3. BUG-G FIX: Duplicate booking protection (same customer + service + date, not cancelled/completed)
    const bookingDate = new Date(data.scheduled_date);
    const dayStart = new Date(bookingDate); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd   = new Date(bookingDate); dayEnd.setUTCHours(23, 59, 59, 999);
    const duplicate = await tx.booking.findFirst({
      where: {
        customer_id: customer.id,
        service_id: service.id,
        status: { notIn: ['Cancelled', 'Completed'] },
        scheduled_date: { gte: dayStart, lte: dayEnd }
      }
    });
    if (duplicate) {
      throw new AppError(
        `An active booking for this customer and service already exists on this date (${duplicate.booking_id}).`,
        409
      );
    }

    // 4. Generate Booking ID
    const booking_id = await generateBookingId(tx);

    // 5. Pre-compute GST
    if (!(city as any).state) {
      throw new AppError("The selected city has no state configured. Please configure the city before creating bookings.", 400);
    }
    const bookingState = (city as any).state;
    const gst2 = calculateGST(
      Number(pricingRule.base_price),
      Number(pricingRule.cgst_percent),
      Number(pricingRule.sgst_percent),
      Number(pricingRule.igst_percent),
      bookingState,
      companyState
    );

    // 6. Create Booking
    const booking = await tx.booking.create({
      data: {
        booking_id,
        customer_id: customer.id,
        city_id: city.id,
        service_id: service.id,
        pricing_rule_id: pricingRule.id,
        scheduled_date: new Date(data.scheduled_date),
        slot: data.slot,
        customer_name: customer.name,
        customer_phone: customer.phone,
        address_line_1: data.address_line_1,
        address_line_2: data.address_line_2,
        area: data.area,
        landmark: data.landmark,
        city_name: data.city_name,
        postal_code: data.postal_code,
        state: bookingState,
        country: data.country,
        latitude: data.latitude,
        longitude: data.longitude,
        service_name: service.name,
        base_price: pricingRule.base_price,
        discount: 0,
        cgst_percent: gst2.cgst_percent,
        cgst_amount: gst2.cgst_amount,
        sgst_percent: gst2.sgst_percent,
        sgst_amount: gst2.sgst_amount,
        igst_percent: gst2.igst_percent,
        igst_amount: gst2.igst_amount,
        tax: gst2.total_tax,
        final_amount: pricingRule.base_price + gst2.total_tax,
        notes: data.notes,
        special_instructions: data.special_instructions,
        created_by: userId,
        status: 'Pending',
      }
    });

    await tx.bookingHistory.create({
      data: { booking_id: booking.id, to_status: 'Pending', changed_by: userId }
    });

    return booking;
  }, {
    maxWait: 5000,
    timeout: 15000
  });
  // Publish AFTER the transaction commits — handler sees consistent DB state
  eventBus.publish('Booking.Created', { booking_id: booking.id, scheduled_date: booking.scheduled_date });
  return booking;
};

export const updateBooking = async (id: string, data: any, userId: string) => {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw new AppError('Booking not found', 404);

  // Financial field lock — these are immutable after creation
  const LOCKED_FIELDS = ['base_price', 'discount', 'tax', 'final_amount', 'service_id', 'pricing_rule_id'];
  const attempted = LOCKED_FIELDS.filter(f => f in data);
  if (attempted.length > 0) {
    throw new AppError(
      `Financial and identity fields are immutable after booking creation: ${attempted.join(', ')}`,
      400
    );
  }

  return prisma.booking.update({
    where: { id },
    data: {
      notes: data.notes,
      special_instructions: data.special_instructions,
      updated_by: userId
    }
  });
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  Draft: ['Pending', 'Cancelled'],
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Scheduled', 'Cancelled'],
  Scheduled: ['Assigned', 'Cancelled'],
  Assigned: ['InProgress', 'Cancelled'],
  InProgress: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
  NoShow: []
};

export const updateBookingStatus = async (id: string, newStatus: string, userId: string) => {
  // BUG-F FIX: Cancellation must go through /cancel endpoint to enforce reason + cascade
  if (newStatus === 'Cancelled') {
    throw new AppError(
      'Use PATCH /bookings/:id/cancel to cancel a booking. A cancellation reason is required and the linked Job will be cancelled automatically.',
      400
    );
  }

  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id } });
    if (!booking) throw new AppError('Booking not found', 404);

    const allowed = VALID_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(newStatus)) {
      throw new AppError(`Invalid transition from ${booking.status} to ${newStatus}`, 400);
    }

    const updateData: any = { status: newStatus, updated_by: userId };
    
    // Lifecycle timestamps
    if (newStatus === 'Confirmed') updateData.confirmed_at = new Date();
    if (newStatus === 'Scheduled') updateData.scheduled_at = new Date();
    if (newStatus === 'Assigned') updateData.assigned_at = new Date();
    if (newStatus === 'InProgress') updateData.started_at = new Date();
    if (newStatus === 'Completed') updateData.completed_at = new Date();

    const updated = await tx.booking.update({
      where: { id },
      data: updateData
    });

    await tx.bookingHistory.create({
      data: {
        booking_id: booking.id,
        from_status: booking.status,
        to_status: newStatus as any,
        changed_by: userId
      }
    });

    return updated;
  }, {
    maxWait: 5000,
    timeout: 15000
  });
};

export const rescheduleBooking = async (id: string, data: any, userId: string) => {
  validateSlot(data.slot);
  // BUG-E FIX: Fully transactional — syncs Job date + creates history entries in both tables
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id }, include: { job: true } });
    if (!booking) throw new AppError('Booking not found', 404);

    if (['Completed', 'Cancelled', 'NoShow'].includes(booking.status)) {
      throw new AppError('Cannot reschedule a completed, cancelled, or no-show booking', 400);
    }

    const newDate = new Date(data.scheduled_date);
    
    const linkedJob = (booking as any).job;
    const isLinkedJobActive = linkedJob && !['Cancelled', 'Completed'].includes(linkedJob.status);

    // 1. Availability Validation for Rescheduling
    if (isLinkedJobActive && linkedJob.assigned_user_id) {
      const duration = linkedJob.estimated_duration_minutes || 60;
      const availability = await checkAvailability(linkedJob.assigned_user_id, booking.city_id, newDate, duration, linkedJob.id);
      if (!availability.available) {
        throw new AppError(`Cannot reschedule: ${availability.reason}`, 409);
      }
    }

    // 2. Update Booking
    const updated = await tx.booking.update({
      where: { id },
      data: { scheduled_date: newDate, slot: data.slot, updated_by: userId }
    });

    // 2. Create BookingHistory
    await tx.bookingHistory.create({
      data: {
        booking_id: booking.id,
        from_status: booking.status,
        to_status: booking.status, // Status unchanged — only date moved
        changed_by: userId
      }
    });

    // 4. Sync linked Job if exists and not terminal
    if (isLinkedJobActive) {
      await tx.job.update({
        where: { id: linkedJob.id },
        data: { scheduled_start: newDate, status: 'Pending', updated_by: userId }
      });
      await tx.jobHistory.create({
        data: {
          job_id: linkedJob.id,
          from_status: linkedJob.status,
          to_status: 'Pending',
          changed_by: userId,
          note: `Rescheduled via Booking ${booking.booking_id} to ${newDate.toISOString()}`
        }
      });
    }

    return updated;
  }, {
    maxWait: 5000,
    timeout: 15000
  });
};

export const cancelBooking = async (id: string, cancel_reason: string, userId: string) => {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id }, include: { job: true } });
    if (!booking) throw new AppError('Booking not found', 404);

    if (booking.status === 'Cancelled') throw new AppError('Booking is already cancelled', 400);
    if (booking.status === 'Completed') throw new AppError('Cannot cancel a completed booking', 400);

    const updated = await tx.booking.update({
      where: { id },
      data: {
        status: 'Cancelled',
        cancel_reason,
        cancelled_at: new Date(),
        updated_by: userId
      }
    });

    await tx.bookingHistory.create({
      data: {
        booking_id: booking.id,
        from_status: booking.status,
        to_status: 'Cancelled',
        changed_by: userId
      }
    });

    // BUG-001 FIX: Cascade-cancel the linked Job if it exists and is not already in a terminal state
    const linkedJob = (booking as any).job;
    if (linkedJob && !['Completed', 'Cancelled'].includes(linkedJob.status)) {
      await tx.job.update({
        where: { id: linkedJob.id },
        data: {
          status: 'Cancelled',
          cancellation_reason: `Parent booking cancelled. Reason: ${cancel_reason}`,
          updated_by: userId,
        }
      });
      await tx.jobHistory.create({
        data: {
          job_id: linkedJob.id,
          from_status: linkedJob.status,
          to_status: 'Cancelled',
          changed_by: userId,
          note: `Cascade-cancelled: parent booking ${booking.booking_id} was cancelled.`
        }
      });
    }

    return updated;
  }, {
    maxWait: 5000,
    timeout: 15000
  });
};
