import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { startOfDay, addDays, getHours } from 'date-fns';
import { BUSINESS_HOURS } from '../config/business-hours';

const prisma = new PrismaClient();

export const checkAvailability = async (
  userId: string,
  cityId: string,
  startTime: Date,
  durationMinutes: number,
  excludeJobId?: string
) => {
  const technician = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: true }
  });

  if (!technician || !technician.is_active) {
    return { available: false, reason: 'Technician not found or inactive' };
  }

  // 1. City Restrictions
  if (technician.city_id && technician.city_id !== cityId) {
    return { available: false, reason: 'Technician is not assigned to this city' };
  }

  // 2. Working Hours — derived from central config, not hardcoded
  const startHour = getHours(startTime);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const endHour = getHours(endTime);
  
  if (startHour < BUSINESS_HOURS.START_HOUR || endHour > BUSINESS_HOURS.END_HOUR || (endHour === BUSINESS_HOURS.END_HOUR && endTime.getMinutes() > 0)) {
    return { available: false, reason: `Job falls outside of business hours (${BUSINESS_HOURS.START_HOUR}:00 - ${BUSINESS_HOURS.END_HOUR}:00)` };
  }

  // 3. Overlapping Jobs
  const overlappingJobs = await prisma.job.findMany({
    where: {
      assigned_user_id: userId,
      status: { notIn: ['Completed', 'Cancelled', 'Failed', 'NoAccess', 'CustomerNotAvailable'] },
      id: excludeJobId ? { not: excludeJobId } : undefined,
      scheduled_start: { lt: endTime },
    }
  });

  const hasOverlap = overlappingJobs.some(existingJob => {
    const existingEnd = new Date(existingJob.scheduled_start.getTime() + (existingJob.estimated_duration_minutes || 60) * 60000);
    return existingEnd > startTime;
  });

  if (hasOverlap) {
    return { available: false, reason: 'Technician has an overlapping job during this time slot', conflict: true };
  }

  // 4. Staff Availability / Leaves / Workload (Phase 5 Extension)
  // Check the StaffAvailability table for holidays or capacity limits
  const localStartOfDay = startOfDay(startTime);
  const localEndOfDay = addDays(localStartOfDay, 1);

  const availabilityRecord = await prisma.staffAvailability.findFirst({
    where: {
      staff_id: userId,
      date: { gte: localStartOfDay, lt: localEndOfDay }
    }
  });

  if (availabilityRecord) {
    if (!availabilityRecord.is_available) {
      return { available: false, reason: 'Technician is on leave or unavailable on this day' };
    }
    if (availabilityRecord.daily_job_limit && availabilityRecord.jobs_assigned >= availabilityRecord.daily_job_limit) {
      return { available: false, reason: 'Technician has reached their daily job limit' };
    }
  }

  return { available: true };
};
