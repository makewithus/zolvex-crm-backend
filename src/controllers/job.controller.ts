import { Request, Response } from 'express';
import * as jobService from '../services/job.service';
import * as dispatchService from '../services/dispatch.service';
import { sendSuccess } from '../utils/response.util';

export const getJobs = async (req: Request, res: Response) => {
  const user = (req as any).user;
  
  const filters: any = { ...req.query };
  
  // Enforce RBAC filtering
  if (user.role === 'Field Staff') {
    filters.assigned_user_id = user.id;
  }
  // (City Manager filtering would go here, checking joined booking city_id)

  const jobs = await jobService.getJobs(filters);
  sendSuccess(res, 200, 'Jobs retrieved', jobs);
};

export const getJobById = async (req: Request, res: Response) => {
  const job = await jobService.getJobById(req.params.id as string);
  sendSuccess(res, 200, 'Job retrieved', job);
};

export const createJobFromBooking = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { bookingId } = req.params;
  const { priority } = req.body;
  const job = await jobService.createJobFromBooking(bookingId as string, user.id, priority);
  sendSuccess(res, 201, 'Job created', job);
};

export const updateJobStatus = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { status, failureReason, cancellationReason, completionNotes, version_token } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;

  const job = await jobService.transitionJobStatus(
    req.params.id as string, 
    status, 
    user.id, 
    user.role, 
    ipAddress as string, 
    { failureReason, cancellationReason, completionNotes, versionToken: version_token }
  );
  
  sendSuccess(res, 200, 'Job status updated', job);
};

export const assignJob = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { assigned_user_id, version_token, override_conflict } = req.body;
  
  await dispatchService.assignTechnician(req.params.id as string, assigned_user_id, user.id, version_token, override_conflict);
  sendSuccess(res, 200, 'Job assigned successfully', {});
};

export const rescheduleJob = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { new_scheduled_start, version_token } = req.body;
  
  await dispatchService.rescheduleJob(req.params.id as string, new_scheduled_start, user.id, version_token);
  sendSuccess(res, 200, 'Job rescheduled successfully', {});
};

export const getCalendarJobs = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { start_date, end_date, city_id, status, assigned_user_id } = req.query;

  if (!start_date || !end_date) {
    return sendSuccess(res, 400, 'start_date and end_date are required', null);
  }

  const filters: any = {};
  if (status) filters.status = status;
  if (assigned_user_id) filters.assigned_user_id = assigned_user_id;

  // RBAC for City Manager
  if (user.role === 'City Manager' && user.city_id) {
    filters.city_id = user.city_id;
  } else if (city_id) {
    filters.city_id = city_id as string;
  }

  const jobs = await jobService.getJobsByDateRange(start_date as string, end_date as string, filters);

  // Compute KPIs
  // Compute KPIs for the selected date
  const targetDate = new Date(start_date as string);
  const nextDate = new Date(end_date as string);

  const kpis = {
    total_today: 0,
    unassigned: 0,
    running: 0,
    delayed: 0,
    completed: 0,
    cancelled: 0
  };

  const now = new Date();

  jobs.forEach(job => {
    const jobDate = new Date(job.scheduled_start);
    const isTargetDay = jobDate >= targetDate && jobDate <= nextDate;
    
    if (isTargetDay) {
      kpis.total_today++;
      if (!job.assigned_user_id) kpis.unassigned++;
      if (['Travelling', 'Arrived', 'Started'].includes(job.status)) kpis.running++;
      if (job.status === 'Completed') kpis.completed++;
      if (job.status === 'Cancelled') kpis.cancelled++;

      // Delayed if Pending/Assigned and past the scheduled start + 30 mins
      if (['Pending', 'Assigned', 'Accepted'].includes(job.status)) {
        const threshold = new Date(jobDate.getTime() + 30 * 60000);
        if (now > threshold) kpis.delayed++;
      }
    }
  });

  sendSuccess(res, 200, 'Calendar jobs retrieved', { jobs, kpis });
};
