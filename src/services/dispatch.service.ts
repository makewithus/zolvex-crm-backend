import { PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import * as jobService from './job.service';

const prisma = new PrismaClient();

/**
 * DispatchService
 * Responsible for assignment, workload validation, overlap detection, and rescheduling.
 */

export const assignTechnician = async (
  jobId: string,
  userId: string, // the new technician to assign
  assignedByUserId: string,
  tx?: Prisma.TransactionClient
) => {
  const db = tx || prisma;
  
  const job = await db.job.findUnique({ where: { id: jobId }, include: { booking: true } });
  if (!job) throw new AppError('Job not found', 404);

  const technician = await db.user.findUnique({ where: { id: userId } });
  if (!technician || !technician.is_active) throw new AppError('Technician not found or inactive', 400);

  // 1. Validate City match
  if (technician.city_id !== job.booking.city_id) {
    throw new AppError('Technician is not assigned to this city', 400);
  }

  // 2. Validate Overlap
  const jobDurationMinutes = job.estimated_duration_minutes || 60;
  const newJobEnd = new Date(job.scheduled_start.getTime() + jobDurationMinutes * 60000);

  const overlappingJobs = await db.job.findMany({
    where: {
      assigned_user_id: userId,
      status: { in: ['Assigned', 'Accepted', 'Travelling', 'Arrived', 'Started'] },
      id: { not: jobId },
      scheduled_start: { lt: newJobEnd },
    }
  });
  
  // We need to check if the end of overlapping jobs > start of this job
  const hasOverlap = overlappingJobs.some(existingJob => {
    const existingEnd = new Date(existingJob.scheduled_start.getTime() + (existingJob.estimated_duration_minutes || 60) * 60000);
    return existingEnd > job.scheduled_start;
  });

  if (hasOverlap) {
    throw new AppError('Technician has an overlapping job during this time slot', 409);
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
      reason: previousUserId ? 'Reassignment' : 'Initial Assignment'
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
  tx?: Prisma.TransactionClient
) => {
  const db = tx || prisma;
  const job = await db.job.findUnique({ where: { id: jobId }, include: { booking: true } });
  if (!job) throw new AppError('Job not found', 404);

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
