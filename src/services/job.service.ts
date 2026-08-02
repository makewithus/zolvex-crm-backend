import { PrismaClient, JobStatus, Prisma, JobPriority, JobFailureReason } from '@prisma/client';
import { AppError } from '../utils/AppError';
import * as invoiceService from './invoice.service';
import { generateAndUploadInvoicePdf } from './invoicePdf.service';
import { env } from '../config/env';
import { eventBus } from '../events/eventBus';

const prisma = new PrismaClient();

const generateJobId = async (tx: Prisma.TransactionClient): Promise<string> => {
  // @ts-ignore
  const sequence = await tx.jobSequence.update({
    where: { id: 1 },
    data: { value: { increment: 1 } },
  });
  return `JOB-${sequence.value.toString().padStart(6, '0')}`;
};

/**
 * Creates a Job from a Booking transactionally.
 */
export const createJobFromBooking = async (
  bookingId: string, 
  createdById: string, 
  priority: JobPriority = 'Normal'
) => {
  return await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new AppError('Booking not found', 404);
    
    if (booking.status === 'Cancelled' || booking.status === 'Completed') {
      throw new AppError('Cannot create a job from a Cancelled or Completed booking', 400);
    }

    const existingJob = await tx.job.findUnique({ where: { booking_id: bookingId } });
    if (existingJob) throw new AppError('Job already exists for this booking', 409);

    // Make sure sequence exists
    // @ts-ignore
    const seq = await tx.jobSequence.findUnique({ where: { id: 1 } });
    if (!seq) {
      // @ts-ignore
      await tx.jobSequence.create({ data: { id: 1, value: 0 } });
    }

    const jobIdString = await generateJobId(tx);

    const initialStatus = booking.assigned_user_id ? 'Assigned' : 'Pending';

    const job = await tx.job.create({
      data: {
        job_id: jobIdString,
        booking_id: booking.id,
        scheduled_start: booking.scheduled_date,
        estimated_duration_minutes: booking.estimated_duration_minutes || 60,
        status: initialStatus,
        assigned_user_id: booking.assigned_user_id,
        priority,
        created_by: createdById,
      }
    });

    await tx.jobHistory.create({
      data: {
        job_id: job.id,
        to_status: initialStatus,
        changed_by: createdById,
        note: 'Job generated from Booking'
      }
    });

    if (booking.assigned_user_id) {
      await tx.jobAssignmentHistory.create({
        data: {
          job_id: job.id,
          new_user_id: booking.assigned_user_id,
          assigned_by: createdById,
          reason: 'Inherited from Booking assignment'
        }
      });
    }

    return job;
  }, {
    maxWait: 5000,
    timeout: 10000
  });
};

/**
 * Single function to handle all state transitions for a Job.
 * Validates legal transitions, syncs upward to Booking, and writes history.
 */
export const transitionJobStatus = async (
  jobId: string,
  newStatus: JobStatus,
  userId: string,
  userRole: string,
  ipAddress?: string,
  options?: {
    failureReason?: JobFailureReason;
    cancellationReason?: string;
    completionNotes?: string;
    versionToken?: string;
  }
) => {
  const result = await prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId }, include: { booking: true } });
    if (!job) throw new AppError('Job not found', 404);

    if (options?.versionToken && job.updated_at.toISOString() !== options.versionToken) {
      throw new AppError('This job was updated by another dispatcher. Please refresh.', 409);
    }

    // GUARD: Do not allow status changes on jobs whose parent booking is cancelled,
    // UNLESS the transition itself is to Cancelled (cascade from booking is always allowed).
    if (job.booking.status === 'Cancelled' && newStatus !== 'Cancelled') {
      throw new AppError('Cannot update status — the parent booking has been cancelled.', 400);
    }

    const currentStatus = job.status;
    if (currentStatus === newStatus) return job; // No-op

    // 1. Validate Legal Transition (simplified examples based on architecture)
    if (currentStatus === 'Completed' || currentStatus === 'Cancelled') {
      throw new AppError(`Cannot transition from terminal state ${currentStatus}`, 400);
    }
    
    // BUG-H FIX: Field Staff cannot cancel or reschedule — Dispatcher-only actions
    const DISPATCHER_ONLY_STATUSES: JobStatus[] = ['Cancelled', 'Rescheduled'];
    if (userRole === 'Field Staff' && DISPATCHER_ONLY_STATUSES.includes(newStatus)) {
      throw new AppError(
        'Field staff cannot cancel or reschedule a job. Report the issue (NoAccess, CustomerNotAvailable, Failed) and contact your dispatcher.',
        403
      );
    }

    // Field Staff forward-only progression validation
    const fieldProgression = ['Assigned', 'Accepted', 'Travelling', 'Arrived', 'Started', 'Completed'];
    if (userRole === 'Field Staff') {
      const currentIndex = fieldProgression.indexOf(currentStatus);
      const newIndex = fieldProgression.indexOf(newStatus);
      if (newIndex !== -1 && currentIndex !== -1 && newIndex < currentIndex) {
        throw new AppError(`Field staff cannot reverse job progression: ${currentStatus} -> ${newStatus}`, 400);
      }
    }

    // 2. Validate Business Rules on Status Transitions
    const MIN_PHOTOS = 3;

    if (newStatus === 'Started') {
      const beforeCount = await tx.jobMedia.count({
        where: { job_id: jobId, category: 'Before' }
      });
      if (beforeCount < MIN_PHOTOS) {
        throw new AppError(
          `Cannot start job: at least ${MIN_PHOTOS} before photos are required (${beforeCount} uploaded).`,
          400
        );
      }
    }

    if (newStatus === 'Completed') {
      if (!options?.completionNotes) {
        throw new AppError('Completion notes are required to complete a job', 400);
      }
      const afterCount = await tx.jobMedia.count({
        where: { job_id: jobId, category: 'After' }
      });
      if (afterCount < MIN_PHOTOS) {
        throw new AppError(
          `Cannot complete job: at least ${MIN_PHOTOS} after photos are required (${afterCount} uploaded).`,
          400
        );
      }
    }

    // 3. Prepare Updates
    const jobUpdateData: Prisma.JobUpdateInput = {
      status: newStatus,
      updated_by: userId,
    };
    
    // Set Timestamps based on new status
    if (newStatus === 'Started') jobUpdateData.actual_start = new Date();
    if (newStatus === 'Completed') {
       jobUpdateData.actual_end = new Date();
       jobUpdateData.completion_notes = options?.completionNotes;
    }
    if (newStatus === 'Cancelled') jobUpdateData.cancellation_reason = options?.cancellationReason;
    if (['Failed', 'NoAccess', 'CustomerNotAvailable'].includes(newStatus)) {
       jobUpdateData.failure_reason = options?.failureReason;
    }

    const updatedJob = await tx.job.update({
      where: { id: jobId },
      data: jobUpdateData,
    });

    // 4. Create History
    await tx.jobHistory.create({
      data: {
        job_id: job.id,
        from_status: currentStatus,
        to_status: newStatus,
        changed_by: userId,
        changed_by_role: userRole,
        ip_address: ipAddress,
      }
    });

    // 5. Upward Sync to Booking
    let newBookingStatus = job.booking.status;
    
    if (newStatus === 'Assigned') newBookingStatus = 'Assigned';
    if (['Travelling', 'Arrived', 'Started'].includes(newStatus)) newBookingStatus = 'InProgress';
    if (newStatus === 'Completed') newBookingStatus = 'Completed';
    if (newStatus === 'Cancelled') newBookingStatus = 'Cancelled';
    if (['Failed', 'NoAccess', 'CustomerNotAvailable'].includes(newStatus)) newBookingStatus = 'Pending'; // Returns to dispatch pool

    if (newBookingStatus !== job.booking.status) {
      await tx.booking.update({
        where: { id: job.booking_id },
        data: { status: newBookingStatus, updated_by: userId }
      });
      await tx.bookingHistory.create({
        data: {
          booking_id: job.booking_id,
          from_status: job.booking.status,
          to_status: newBookingStatus,
          changed_by: userId
        }
      });
    }

    // 6. Auto Invoice Generation — inside transaction for true atomicity.
    // If invoice creation fails, the ENTIRE transaction rolls back:
    // Job stays at previous status, Booking stays at previous status.
    // No orphan completed bookings can exist.
    if (newStatus === 'Completed') {
      const mode = env.INVOICE_GENERATION_MODE;
      if (mode === 'AUTO') {
        // autoIssue=true → Invoice created as 'Issued' so it is immediately visible
        // to Reports financial queries (which filter status='Issued')
        await invoiceService.generateInvoiceFromBookingTx(tx, job.booking_id, userId, true);
      }
    }

    return updatedJob;
  }, {
    maxWait: 5000,
    timeout: 15000
  });

  // ── R2 Invoice PDF Upload (outside transaction — async, non-blocking) ──────
  // If AUTO mode generated an invoice, attempt to upload PDF to R2.
  // This runs AFTER the transaction commits. Failure here does NOT affect
  // job completion or invoice creation — pdf_url simply stays null.
  if (newStatus === 'Completed' && env.INVOICE_GENERATION_MODE === 'AUTO') {
    const createdInvoice = await prisma.invoice.findFirst({
      where: { booking_id: result.booking_id },
      orderBy: { created_at: 'desc' },
      select: { id: true }
    });
    if (createdInvoice) {
      // Fire-and-forget — do not await
      generateAndUploadInvoicePdf(createdInvoice.id).catch(() => {});
    }
  }

  if (newStatus === 'Completed') {
    eventBus.publish('Job.Completed', { job_id: result.id });
  }

  return result;
};

export const getJobs = async (filters: any) => {
  const where: any = {};
  // BUG-D FIX: Handle array of statuses using Prisma `in` operator
  if (filters.status) {
    where.status = Array.isArray(filters.status)
      ? { in: filters.status }
      : filters.status;
  }
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigned_user_id) where.assigned_user_id = filters.assigned_user_id;
  
  return await prisma.job.findMany({
    where,
    include: { booking: { include: { customer: true, city: true, service: true } }, assignedUser: { select: { id: true, name: true } } },
    orderBy: { scheduled_start: 'asc' }
  });
};

export const getJobsByDateRange = async (startDate: string, endDate: string, filters: any) => {
  const where: any = {
    scheduled_start: {
      gte: new Date(startDate),
      lte: new Date(endDate)
    }
  };

  if (filters.status) where.status = filters.status;
  if (filters.assigned_user_id) where.assigned_user_id = filters.assigned_user_id;
  if (filters.city_id) where.booking = { city_id: filters.city_id };

  return await prisma.job.findMany({
    where,
    include: { 
      booking: { include: { customer: true, city: true, service: true } }, 
      assignedUser: { select: { id: true, name: true } } 
    },
    orderBy: { scheduled_start: 'asc' }
  });
};

export const getJobById = async (id: string) => {
  const job = await prisma.job.findUnique({
    where: { id },
    include: { 
      booking: true, 
      assignedUser: { select: { id: true, name: true, phone: true } },
      history: { orderBy: { changed_at: 'asc' } },
      assignment_history: { orderBy: { assigned_at: 'asc' } },
      media: true
    }
  });
  if (!job) throw new AppError('Job not found', 404);
  return job;
};

export const addJobMedia = async (jobId: string, mediaFiles: any[], uploadedBy: string) => {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new AppError('Job not found', 404);

  const mediaData = mediaFiles.map(file => ({
    job_id: jobId,
    type: file.type,
    category: file.category,
    url: file.url,
    uploaded_by: uploadedBy
  }));

  await prisma.jobMedia.createMany({
    data: mediaData
  });

  return prisma.jobMedia.findMany({ where: { job_id: jobId } });
};

