import { PrismaClient, Prisma } from '@prisma/client';
import { startOfDay, endOfDay, parseISO } from 'date-fns';

const prisma = new PrismaClient();

export interface ReportFilters {
  start_date?: string;
  end_date?: string;
  city_id?: string;
  assigned_user_id?: string;
  customer_phone?: string;
  status?: string;
}

// ----------------------------------------------------------------------
// UTILS
// ----------------------------------------------------------------------

const buildDateFilter = (field: string, filters: ReportFilters) => {
  if (!filters.start_date && !filters.end_date) return {};
  const filter: any = {};
  if (filters.start_date) filter.gte = new Date(filters.start_date);
  if (filters.end_date) filter.lte = new Date(filters.end_date);
  return { [field]: filter };
};

// ----------------------------------------------------------------------
// FINANCIAL KPIs (Single Source of Truth)
// ----------------------------------------------------------------------

export const getRevenueSummary = async (filters: ReportFilters) => {
  const where: Prisma.InvoiceWhereInput = {
    status: 'Issued',
    ...buildDateFilter('issue_date', filters)
  };
  if (filters.city_id) where.city_id = filters.city_id;
  if (filters.customer_phone) where.customer_phone = filters.customer_phone;

  const aggregate = await prisma.invoice.aggregate({
    where,
    _sum: { final_amount: true, total_tax_amount: true, base_amount: true },
    _count: { id: true }
  });

  return {
    total_revenue: Number(aggregate._sum.final_amount || 0),
    total_tax: Number(aggregate._sum.total_tax_amount || 0),
    total_subtotal: Number(aggregate._sum.base_amount || 0),
    invoice_count: aggregate._count.id
  };
};

export const getOutstandingSummary = async (filters: ReportFilters) => {
  const where: Prisma.InvoiceWhereInput = {
    status: 'Issued',
    balance_due: { gt: 0 },
    ...buildDateFilter('issue_date', filters) // Reconcile: filter by invoice issue_date
  };
  if (filters.city_id) where.city_id = filters.city_id;
  if (filters.customer_phone) where.customer_phone = filters.customer_phone;

  const aggregate = await prisma.invoice.aggregate({
    where,
    _sum: { balance_due: true },
    _count: { id: true }
  });

  return {
    total_outstanding: Number(aggregate._sum.balance_due || 0),
    outstanding_invoices_count: aggregate._count.id
  };
};

export const getCollectionsSummary = async (filters: ReportFilters) => {
  const where: Prisma.PaymentWhereInput = {
    payment_status: 'Completed',
  };
  
  // Reconcile: we want collections for the invoices issued in this period, not payments made in this period.
  const invoiceWhere: Prisma.InvoiceWhereInput = { ...buildDateFilter('issue_date', filters) };
  if (filters.city_id) invoiceWhere.city_id = filters.city_id;
  
  if (Object.keys(invoiceWhere).length > 0) {
    where.invoice = invoiceWhere;
  }

  const aggregate = await prisma.payment.aggregate({
    where,
    _sum: { amount: true },
    _count: { id: true }
  });

  return {
    total_collected: Number(aggregate._sum.amount || 0),
    payment_count: aggregate._count.id
  };
};

export const getGSTSummary = async (filters: ReportFilters) => {
  const where: Prisma.InvoiceWhereInput = {
    status: 'Issued',
    ...buildDateFilter('issue_date', filters)
  };
  if (filters.city_id) where.city_id = filters.city_id;

  const aggregate = await prisma.invoice.aggregate({
    where,
    _sum: { cgst_amount: true, sgst_amount: true, igst_amount: true, total_tax_amount: true }
  });

  return {
    cgst: Number(aggregate._sum.cgst_amount || 0),
    sgst: Number(aggregate._sum.sgst_amount || 0),
    igst: Number(aggregate._sum.igst_amount || 0),
    total_tax: Number(aggregate._sum.total_tax_amount || 0)
  };
};

// ----------------------------------------------------------------------
// OPERATIONAL KPIs (Single Source of Truth)
// ----------------------------------------------------------------------

export const getBookingSummary = async (filters: ReportFilters) => {
  const where: Prisma.BookingWhereInput = {
    ...buildDateFilter('scheduled_date', filters)
  };
  if (filters.city_id) where.city_id = filters.city_id;
  if (filters.status) where.status = filters.status as any;

  const groupBy = await prisma.booking.groupBy({
    by: ['status'],
    where,
    _count: { id: true }
  });

  return groupBy.reduce((acc, curr) => {
    acc[curr.status] = curr._count.id;
    return acc;
  }, {} as Record<string, number>);
};

export const getJobSummary = async (filters: ReportFilters) => {
  const where: Prisma.JobWhereInput = {
    ...buildDateFilter('scheduled_start', filters)
  };
  if (filters.city_id) where.booking = { city_id: filters.city_id };
  if (filters.assigned_user_id) where.assigned_user_id = filters.assigned_user_id;

  const groupBy = await prisma.job.groupBy({
    by: ['status'],
    where,
    _count: { id: true }
  });

  return groupBy.reduce((acc, curr) => {
    acc[curr.status] = curr._count.id;
    return acc;
  }, {} as Record<string, number>);
};

export const getTechnicianProductivity = async (filters: ReportFilters) => {
  const where: Prisma.JobWhereInput = {
    status: 'Completed',
    ...buildDateFilter('actual_end', filters)
  };
  if (filters.city_id) where.booking = { city_id: filters.city_id };
  if (filters.assigned_user_id) where.assigned_user_id = filters.assigned_user_id;

  const jobs = await prisma.job.findMany({
    where,
    select: {
      assigned_user_id: true,
      actual_start: true,
      actual_end: true,
      estimated_duration_minutes: true,
      // Join User to get name
      assignedUser: { select: { id: true, name: true } }
    }
  });

  const techStats: Record<string, { name: string; jobs_completed: number, total_scheduled_mins: number, total_actual_mins: number }> = {};

  jobs.forEach(job => {
    if (!job.assigned_user_id) return;
    
    if (!techStats[job.assigned_user_id]) {
      techStats[job.assigned_user_id] = {
        name: job.assignedUser?.name || 'Unknown',
        jobs_completed: 0,
        total_scheduled_mins: 0,
        total_actual_mins: 0
      };
    }

    const stat = techStats[job.assigned_user_id];
    stat.jobs_completed += 1;
    stat.total_scheduled_mins += job.estimated_duration_minutes || 0;
    
    if (job.actual_start && job.actual_end) {
      const diffMins = Math.round((job.actual_end.getTime() - job.actual_start.getTime()) / 60000);
      stat.total_actual_mins += diffMins;
    }
  });

  return techStats;
};
