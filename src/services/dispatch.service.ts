import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import * as jobService from './job.service';
import { checkAvailability } from './technician-availability.service';

const prisma = new PrismaClient();

/**
 * DispatchService
 * Responsible for assignment, workload validation, overlap detection, and rescheduling.
 */

export const assignTechnician = async (
  jobId: string,
  userId: string, // the new technician to assign
  assignedByUserId: string,
  versionToken?: string,
  overrideConflict?: boolean,
  tx?: Prisma.TransactionClient
) => {
  const db = tx || prisma;
  
  const job = await db.job.findUnique({ where: { id: jobId }, include: { booking: true } });
  if (!job) throw new AppError('Job not found', 404);

  // GUARD: Terminal job states cannot be acted upon
  if (job.status === 'Cancelled') {
    throw new AppError('Cannot assign a technician to a cancelled job.', 400);
  }
  if (job.status === 'Completed') {
    throw new AppError('Cannot assign a technician to a completed job.', 400);
  }

  // GUARD: Parent booking must not be cancelled (BUG-001 fix)
  if (job.booking.status === 'Cancelled') {
    throw new AppError('Cannot assign a technician — the parent booking is cancelled.', 400);
  }

  // Optimistic Concurrency Control (OCC)
  if (versionToken && job.updated_at.toISOString() !== versionToken) {
    throw new AppError('This job was updated by another dispatcher. Please refresh.', 409);
  }

  // 1. Validate Overlap and City via new Service
  const jobDurationMinutes = job.estimated_duration_minutes || 60;
  
  const availability = await checkAvailability(userId, job.booking.city_id, job.scheduled_start, jobDurationMinutes, jobId);
  
  if (!availability.available) {
    if (availability.conflict && overrideConflict) {
      // Allow if explicitly overridden (Super Admin checking happens at controller or via RBAC wrapper)
    } else {
      throw new AppError(availability.reason || 'Technician unavailable', 409);
    }
  }

  // 3. Update Job and Log History
  const previousUserId = job.assigned_user_id;

  await db.job.update({
    where: { id: jobId },
    data: {
      assigned_user_id: userId,
      status: 'Assigned',
      updated_by: assignedByUserId,
    }
  });

  await db.jobAssignmentHistory.create({
    data: {
      job_id: jobId,
      previous_user_id: previousUserId,
      new_user_id: userId,
      assigned_by: assignedByUserId,
      reason: overrideConflict ? 'Reassignment (Conflict Overridden)' : (previousUserId ? 'Reassignment' : 'Initial Assignment')
    }
  });

  await db.jobHistory.create({
    data: {
      job_id: jobId,
      from_status: job.status,
      to_status: 'Assigned',
      changed_by: assignedByUserId,
    }
  });

  // 4. Upward sync to Booking
  await db.booking.update({
    where: { id: job.booking_id },
    data: { status: 'Assigned', updated_by: assignedByUserId }
  });

  await db.bookingHistory.create({
    data: {
      booking_id: job.booking_id,
      from_status: job.booking.status,
      to_status: 'Assigned',
      changed_by: assignedByUserId
    }
  });

  return { success: true };
};

export const rescheduleJob = async (
  jobId: string,
  newScheduledStart: string,
  rescheduledByUserId: string,
  versionToken?: string,
  tx?: Prisma.TransactionClient
) => {
  const db = tx || prisma;
  const job = await db.job.findUnique({ where: { id: jobId }, include: { booking: true } });
  if (!job) throw new AppError('Job not found', 404);

  // GUARD: Terminal job states cannot be rescheduled
  if (job.status === 'Cancelled') {
    throw new AppError('Cannot reschedule a cancelled job.', 400);
  }
  if (job.status === 'Completed') {
    throw new AppError('Cannot reschedule a completed job.', 400);
  }

  // GUARD: Parent booking must not be cancelled
  if (job.booking.status === 'Cancelled') {
    throw new AppError('Cannot reschedule — the parent booking is cancelled.', 400);
  }

  // Optimistic Concurrency Control (OCC)
  if (versionToken && job.updated_at.toISOString() !== versionToken) {
    throw new AppError('This job was updated by another dispatcher. Please refresh.', 409);
  }

  const previousUserId = job.assigned_user_id;
  
  await db.job.update({
    where: { id: jobId },
    data: {
      scheduled_start: new Date(newScheduledStart),
      assigned_user_id: null,
      status: 'Pending',
      updated_by: rescheduledByUserId,
    }
  });

  if (previousUserId) {
    await db.jobAssignmentHistory.create({
      data: {
        job_id: jobId,
        previous_user_id: previousUserId,
        new_user_id: null,
        assigned_by: rescheduledByUserId,
        reason: 'Rescheduled'
      }
    });
  }

  await db.jobHistory.create({
    data: {
      job_id: jobId,
      from_status: job.status,
      to_status: 'Pending',
      changed_by: rescheduledByUserId,
      note: 'Rescheduled'
    }
  });

  await db.booking.update({
    where: { id: job.booking_id },
    data: { 
      scheduled_date: new Date(newScheduledStart),
      status: 'Pending',
      updated_by: rescheduledByUserId
    }
  });

  await db.bookingHistory.create({
    data: {
      booking_id: job.booking_id,
      from_status: job.booking.status,
      to_status: 'Pending',
      changed_by: rescheduledByUserId
    }
  });

  return { success: true };
};
