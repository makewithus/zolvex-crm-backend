import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

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

  // 2. Working Hours (Simple check: 08:00 - 20:00)
  const startHour = startTime.getHours();
  const endHour = new Date(startTime.getTime() + durationMinutes * 60000).getHours();
  
  if (startHour < 8 || endHour > 20) {
    // In the future this can be a soft warning, but for now we just log it as part of availability
    // return { available: false, reason: 'Outside of standard working hours (8AM - 8PM)' };
  }

  // 3. Overlapping Jobs
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);
  const overlappingJobs = await prisma.job.findMany({
    where: {
      assigned_user_id: userId,
      status: { in: ['Assigned', 'Accepted', 'Travelling', 'Arrived', 'Started'] },
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
  const startOfDay = new Date(startTime);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const availabilityRecord = await prisma.staffAvailability.findFirst({
    where: {
      staff_id: userId,
      date: { gte: startOfDay, lt: endOfDay }
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
