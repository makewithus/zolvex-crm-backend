import { Request, Response } from 'express';
import * as reportService from '../services/report.service';
import * as exportService from '../services/export.service';
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

// ----------------------------------------------------------------------
// EXPORT HELPERS
// ----------------------------------------------------------------------

const fmtINR = (val: number) =>
  `INR ${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const buildMeta = (req: Request, title: string): exportService.ExportMeta => {
  const user = (req as any).user;
  const filters = getFilters(req);
  return {
    title,
    generatedBy: user?.name || user?.email || 'System',
    generatedAt: new Date(),
    timezone: 'Asia/Kolkata',
    filters: { ...filters },
    version: 'v1.0',
  };
};

// ----------------------------------------------------------------------
// EXPORT HANDLERS
// ----------------------------------------------------------------------

export const exportFinancialReport = async (req: Request, res: Response) => {
  try {
    const filters = getFilters(req);
    const [revenue, outstanding, collections] = await Promise.all([
      reportService.getRevenueSummary(filters),
      reportService.getOutstandingSummary(filters),
      reportService.getCollectionsSummary(filters),
    ]);

    const exportFormat = req.query.format as string;
    const meta = buildMeta(req, 'Financial Summary Report');

    const headers = ['Metric', 'Amount (INR)', 'Count'];
    const rows = [
      ['Total Revenue',     fmtINR(revenue.total_revenue),       revenue.invoice_count],
      ['Subtotal',          fmtINR(revenue.total_subtotal),       ''],
      ['Total Tax',         fmtINR(revenue.total_tax),            ''],
      ['Total Collected',   fmtINR(collections.total_collected),  collections.payment_count],
      ['Outstanding',       fmtINR(outstanding.total_outstanding),outstanding.outstanding_invoices_count],
    ];

    if (exportFormat === 'pdf') {
      exportService.generatePDF(res, 'financial', meta, headers, rows);
    } else {
      exportService.generateCSV(res, 'financial', meta, headers, rows);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

export const exportOperationalReport = async (req: Request, res: Response) => {
  try {
    const filters = getFilters(req);
    const [bookings, jobs] = await Promise.all([
      reportService.getBookingSummary(filters),
      reportService.getJobSummary(filters),
    ]);

    const exportFormat = req.query.format as string;
    const meta = buildMeta(req, 'Operational Summary Report');

    const headers = ['Category', 'Status', 'Count'];
    const rows: any[][] = [];

    Object.entries(bookings).forEach(([status, count]) => rows.push(['Booking', status, count]));
    Object.entries(jobs).forEach(([status, count]) => rows.push(['Job', status, count]));

    if (exportFormat === 'pdf') {
      exportService.generatePDF(res, 'operational', meta, headers, rows);
    } else {
      exportService.generateCSV(res, 'operational', meta, headers, rows);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

export const exportTechnicianReport = async (req: Request, res: Response) => {
  try {
    const filters = getFilters(req);
    const productivity = await reportService.getTechnicianProductivity(filters);

    const exportFormat = req.query.format as string;
    const meta = buildMeta(req, 'Technician Productivity Report');

    const headers = ['Technician ID', 'Jobs Completed', 'Scheduled (min)', 'Actual (min)', 'Utilization %'];
    const rows: any[][] = [];

    Object.entries(productivity).forEach(([techId, stats]) => {
      const util =
        stats.total_scheduled_mins > 0
          ? Math.round((stats.total_actual_mins / stats.total_scheduled_mins) * 100)
          : 0;
      rows.push([
        techId,
        stats.jobs_completed,
        stats.total_scheduled_mins,
        stats.total_actual_mins > 0 ? stats.total_actual_mins : 'Not recorded',
        stats.total_actual_mins > 0 ? `${util}%` : 'N/A',
      ]);
    });

    if (exportFormat === 'pdf') {
      exportService.generatePDF(res, 'technician', meta, headers, rows);
    } else {
      exportService.generateCSV(res, 'technician', meta, headers, rows);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

export const exportGSTReport = async (req: Request, res: Response) => {
  try {
    const filters = getFilters(req);
    const gst = await reportService.getGSTSummary(filters);

    const exportFormat = req.query.format as string;
    const meta = buildMeta(req, 'GST Summary Report');

    const headers = ['Tax Type', 'Amount (INR)'];
    const rows = [
      ['CGST',      fmtINR(gst.cgst)],
      ['SGST',      fmtINR(gst.sgst)],
      ['IGST',      fmtINR(gst.igst)],
      ['Total Tax', fmtINR(gst.total_tax)],
    ];

    if (exportFormat === 'pdf') {
      exportService.generatePDF(res, 'gst', meta, headers, rows);
    } else {
      exportService.generateCSV(res, 'gst', meta, headers, rows);
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};
