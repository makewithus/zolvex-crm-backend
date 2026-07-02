import { PrismaClient, JobStatus, Prisma, JobPriority, JobFailureReason } from '@prisma/client';
import { AppError } from '../utils/AppError';

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

    const job = await tx.job.create({
      data: {
        job_id: jobIdString,
        booking_id: booking.id,
        scheduled_start: booking.scheduled_date,
        estimated_duration_minutes: booking.estimated_duration_minutes || 60,
        status: 'Pending',
        priority,
        created_by: createdById,
      }
    });

    await tx.jobHistory.create({
      data: {
        job_id: job.id,
        to_status: 'Pending',
        changed_by: createdById,
        note: 'Job generated from Booking'
      }
    });

    return job;
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
  }
) => {
  return await prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId }, include: { booking: true } });
    if (!job) throw new AppError('Job not found', 404);

    const currentStatus = job.status;
    if (currentStatus === newStatus) return job; // No-op

    // 1. Validate Legal Transition (simplified examples based on architecture)
    if (currentStatus === 'Completed' || currentStatus === 'Cancelled') {
      throw new AppError(`Cannot transition from terminal state ${currentStatus}`, 400);
    }
    
    // Field Staff state progression validation
    const fieldProgression = ['Assigned', 'Accepted', 'Travelling', 'Arrived', 'Started', 'Completed'];
    if (userRole === 'Field Staff') {
      const currentIndex = fieldProgression.indexOf(currentStatus);
      const newIndex = fieldProgression.indexOf(newStatus);
      
      if (newIndex !== -1 && currentIndex !== -1) {
         if (newIndex < currentIndex) {
            throw new AppError(`Invalid forward progression: ${currentStatus} -> ${newStatus}`, 400);
         }
      }
    }

    // 2. Validate Business Rules on Completion
    if (newStatus === 'Completed') {
      if (!options?.completionNotes) {
         // In reality, read from configuration layer.
         throw new AppError('Completion notes are required to complete a job', 400);
      }
      // Assuming signature validation or media count validation would go here or be enforced before calling this.
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

    return updatedJob;
  });
};

export const getJobs = async (filters: any) => {
  const where: any = {};
  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigned_user_id) where.assigned_user_id = filters.assigned_user_id;
  
  return await prisma.job.findMany({
    where,
    include: { booking: { include: { customer: true, city: true, service: true } }, assignedUser: { select: { id: true, name: true } } },
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
