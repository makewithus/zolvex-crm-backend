import { Request, Response } from 'express';
import * as reportService from '../services/report.service';
import { sendSuccess } from '../utils/response.util';

const getFilters = (req: Request) => {
  const user = (req as any).user;
  const filters: reportService.ReportFilters = { ...req.query };

  // RBAC Enforcement: City Managers are locked to their own city
  if (user.role === 'City Manager' && user.city_id) {
    filters.city_id = user.city_id;
  }

  // Field Staff should technically not access these routes, but if they do:
  if (user.role === 'Field Staff') {
    filters.assigned_user_id = user.id;
  }

  return filters;
};

// ----------------------------------------------------------------------
// DASHBOARD
// ----------------------------------------------------------------------

export const getDashboardKPIs = async (req: Request, res: Response) => {
  const filters = getFilters(req);
  
  // A lightweight aggregation calling the single-source-of-truth services
  const [revenue, outstanding, collections, bookings, jobs] = await Promise.all([
    reportService.getRevenueSummary(filters),
    reportService.getOutstandingSummary(filters),
    reportService.getCollectionsSummary(filters),
    reportService.getBookingSummary(filters),
    reportService.getJobSummary(filters)
  ]);

  sendSuccess(res, 200, 'Dashboard KPIs retrieved', {
    financial: {
      revenue: revenue.total_revenue,
      outstanding: outstanding.total_outstanding,
      collections: collections.total_collected,
    },
    operational: {
      bookings_by_status: bookings,
      jobs_by_status: jobs
    }
  });
};

// ----------------------------------------------------------------------
// DOMAIN-SPECIFIC REPORTS
// ----------------------------------------------------------------------

export const getFinancialReport = async (req: Request, res: Response) => {
  const filters = getFilters(req);
  const [revenue, outstanding, collections] = await Promise.all([
    reportService.getRevenueSummary(filters),
    reportService.getOutstandingSummary(filters),
    reportService.getCollectionsSummary(filters)
  ]);

  sendSuccess(res, 200, 'Financial report retrieved', {
    revenue,
    outstanding,
    collections
  });
};

export const getOperationalReport = async (req: Request, res: Response) => {
  const filters = getFilters(req);
  const [bookings, jobs] = await Promise.all([
    reportService.getBookingSummary(filters),
    reportService.getJobSummary(filters)
  ]);

  sendSuccess(res, 200, 'Operational report retrieved', {
    bookings,
    jobs
  });
};

export const getTechnicianReport = async (req: Request, res: Response) => {
  const filters = getFilters(req);
  const productivity = await reportService.getTechnicianProductivity(filters);
  
  sendSuccess(res, 200, 'Technician report retrieved', { productivity });
};

export const getGSTReport = async (req: Request, res: Response) => {
  const filters = getFilters(req);
  const gst = await reportService.getGSTSummary(filters);
  
  sendSuccess(res, 200, 'GST report retrieved', { gst });
};
