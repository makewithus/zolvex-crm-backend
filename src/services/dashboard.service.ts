import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Live KPI aggregates. All numbers come from the database.
 * No hardcoded values.
 */
export const getDashboardKPIs = async (role: string, cityId?: string, userId?: string) => {
  // Field Staff: only see their own assigned job counts
  if (role === 'Field Staff' && userId) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);

    const [assignedJobs, jobsToday, pendingJobs, completedJobs] = await Promise.all([
      prisma.job.count({ where: { assigned_user_id: userId, status: { notIn: ['Cancelled', 'Completed'] } } }),
      prisma.job.count({ where: { assigned_user_id: userId, scheduled_start: { gte: todayStart, lte: todayEnd }, status: { notIn: ['Cancelled'] } } }),
      prisma.job.count({ where: { assigned_user_id: userId, status: 'Pending' } }),
      prisma.job.count({ where: { assigned_user_id: userId, status: 'Completed' } }),
    ]);

    return { assigned_jobs: assignedJobs, jobs_today: jobsToday, pending_jobs: pendingJobs, completed_jobs: completedJobs };
  }

  const bookingWhere: any = {};
  const leadWhere: any = {};
  if (role === 'City Manager' && cityId) {
    bookingWhere.city_id = cityId;
    leadWhere.city_id = cityId;
  }

  const [
    totalLeads,
    totalCustomers,
    activeBookings,
    jobsToday,
  ] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.customer.count(),
    prisma.booking.count({
      where: { ...bookingWhere, status: { notIn: ['Cancelled', 'Completed'] } }
    }),
    prisma.job.count({
      where: {
        scheduled_start: {
          gte: new Date(new Date().setUTCHours(0, 0, 0, 0)),
          lte: new Date(new Date().setUTCHours(23, 59, 59, 999)),
        },
        status: { notIn: ['Cancelled'] },
      }
    }),
  ]);

  return { total_leads: totalLeads, total_customers: totalCustomers, active_bookings: activeBookings, jobs_today: jobsToday };
};

/**
 * Last N status changes across Bookings and Jobs — real audit trail.
 */
export const getRecentActivity = async (role: string, cityId?: string, limit = 10) => {
  const [bookingHistory, jobHistory] = await Promise.all([
    prisma.bookingHistory.findMany({
      orderBy: { changed_at: 'desc' },
      take: limit,
      include: { booking: { select: { booking_id: true, customer_name: true } } }
    }),
    prisma.jobHistory.findMany({
      orderBy: { changed_at: 'desc' },
      take: limit,
      include: { job: { select: { job_id: true } } }
    }),
  ]);

  const activities = [
    ...bookingHistory.map(h => ({
      type: 'booking' as const,
      ref: h.booking?.booking_id,
      actor: h.changed_by,
      from: h.from_status as string | null,
      to: h.to_status as string,
      at: h.changed_at,
      label: `Booking ${h.booking?.booking_id} → ${h.to_status}`,
    })),
    ...jobHistory.map(h => ({
      type: 'job' as const,
      ref: h.job?.job_id,
      actor: h.changed_by,
      from: h.from_status as string | null,
      to: h.to_status as string,
      note: h.note,
      at: h.changed_at,
      label: `Job ${h.job?.job_id} → ${h.to_status}`,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);

  return activities;
};

/**
 * Bookings scheduled in the next N hours that are not yet completed or cancelled.
 */
export const getUpcomingBookings = async (role: string, cityId?: string, hours = 48) => {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 3600 * 1000);
  const where: any = {
    scheduled_date: { gte: now, lte: future },
    status: { notIn: ['Cancelled', 'Completed'] },
  };
  if (role === 'City Manager' && cityId) where.city_id = cityId;

  return prisma.booking.findMany({
    where,
    orderBy: { scheduled_date: 'asc' },
    take: 10,
    select: {
      id: true, booking_id: true, customer_name: true, service_name: true,
      scheduled_date: true, status: true, city: { select: { name: true } }
    }
  });
};

/**
 * Revenue: sum of final_amount on Completed bookings for current month.
 * Returns 0 if no data — never a fake number.
 */
export const getRevenueSummary = async (role: string, cityId?: string) => {
  const now = new Date();
  const mtdStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const where: any = { status: 'Completed', completed_at: { gte: mtdStart } };
  if (role === 'City Manager' && cityId) where.city_id = cityId;

  const result = await prisma.booking.aggregate({
    where,
    _sum: { final_amount: true },
    _count: { id: true },
  });

  return {
    mtd_revenue: result._sum.final_amount ?? 0,
    completed_bookings_count: result._count.id,
  };
};

/**
 * Lead pipeline counts by status.
 */
export const getPipelineSummary = async (role: string, cityId?: string) => {
  const where: any = {};
  if (role === 'City Manager' && cityId) where.city_id = cityId;

  const grouped = await prisma.lead.groupBy({
    by: ['status'],
    where,
    _count: { id: true },
  });

  return grouped.reduce((acc, row) => {
    acc[row.status] = row._count.id;
    return acc;
  }, {} as Record<string, number>);
};
