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
  const { status, failureReason, cancellationReason, completionNotes } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress;

  const job = await jobService.transitionJobStatus(
    req.params.id as string, 
    status, 
    user.id, 
    user.role, 
    ipAddress, 
    { failureReason, cancellationReason, completionNotes }
  );
  
  sendSuccess(res, 200, 'Job status updated', job);
};

export const assignJob = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { assigned_user_id } = req.body;
  
  await dispatchService.assignTechnician(req.params.id as string, assigned_user_id, user.id);
  sendSuccess(res, 200, 'Job assigned successfully', {});
};

export const rescheduleJob = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { new_scheduled_start } = req.body;
  
  await dispatchService.rescheduleJob(req.params.id as string, new_scheduled_start, user.id);
  sendSuccess(res, 200, 'Job rescheduled successfully', {});
};
