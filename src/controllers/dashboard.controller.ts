import { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service';
import { sendSuccess } from '../utils/response.util';

export const getKPIs = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const data = await dashboardService.getDashboardKPIs(user.role, user.cityId);
  sendSuccess(res, 200, 'Dashboard KPIs retrieved', data);
};

export const getActivity = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const limit = parseInt(req.query.limit as string) || 10;
  const data = await dashboardService.getRecentActivity(user.role, user.cityId, limit);
  sendSuccess(res, 200, 'Recent activity retrieved', data);
};

export const getUpcomingBookings = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const data = await dashboardService.getUpcomingBookings(user.role, user.cityId, 48);
  sendSuccess(res, 200, 'Upcoming bookings retrieved', data);
};

export const getRevenue = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const data = await dashboardService.getRevenueSummary(user.role, user.cityId);
  sendSuccess(res, 200, 'Revenue summary retrieved', data);
};

export const getPipeline = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const data = await dashboardService.getPipelineSummary(user.role, user.cityId);
  sendSuccess(res, 200, 'Pipeline summary retrieved', data);
};
