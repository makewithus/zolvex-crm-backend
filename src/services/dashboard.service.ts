import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Live KPI aggregates. All numbers come from the database.
 * No hardcoded values.
 */
export const getDashboardKPIs = async (role: string, cityId?: string, userId?: string) => {
const now = new Date();

const todayStart = new Date(now);
todayStart.setUTCHours(0, 0, 0, 0);

const todayEnd = new Date(now);
todayEnd.setUTCHours(23, 59, 59, 999);

// Technician: see only their assigned jobs
if (role === 'Technician' && userId) {
  const [assignedJobs, jobsToday, pendingJobs, completedJobs, upcomingJobs] = await Promise.all([
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        status: { notIn: ['Cancelled', 'Completed'] }
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        scheduled_start: { gte: todayStart, lte: todayEnd },
        status: { not: 'Cancelled' }
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        status: 'Pending'
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        status: 'Completed'
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        scheduled_start: { gte: now },
        status: { notIn: ['Cancelled', 'Completed'] }
      }
    }),
  ]);

  return {
    assigned_jobs: assignedJobs,
    jobs_today: jobsToday,
    pending_jobs: pendingJobs,
    completed_jobs: completedJobs,
    upcoming_jobs: upcomingJobs,
  };
}

// Field Staff: see only their assigned operational data
if (role === 'Field Staff' && userId) {
  const [assignedJobs, jobsToday, pendingJobs, completedJobs] = await Promise.all([
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        status: { notIn: ['Cancelled', 'Completed'] }
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        scheduled_start: { gte: todayStart, lte: todayEnd },
        status: { not: 'Cancelled' }
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        status: 'Pending'
      }
    }),
    prisma.job.count({
      where: {
        assigned_user_id: userId,
        status: 'Completed'
      }
    }),
  ]);

  return {
    assigned_jobs: assignedJobs,
    jobs_today: jobsToday,
    pending_jobs: pendingJobs,
    completed_jobs: completedJobs,
  };
}

// City Manager: scoped to their city
  const bookingWhere: any = {};
  const leadWhere: any = {};
  if (role === 'City Manager' && cityId) {
    bookingWhere.city_id = cityId;
    leadWhere.city_id = cityId;
  }

  const [totalLeads, totalCustomers, activeBookings, jobsToday] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.customer.count(),
    prisma.booking.count({ where: { ...bookingWhere, status: { notIn: ['Cancelled', 'Completed'] } } }),
    prisma.job.count({
      where: {
        scheduled_start: { gte: todayStart, lte: todayEnd },
        status: { notIn: ['Cancelled'] },
        // City Manager: scope Jobs Today to their city via the booking relation
        ...(role === 'City Manager' && cityId ? { booking: { city_id: cityId } } : {}),
      }
    }),
  ]);

  // --- Real Analytics & Trends ---
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  
  const recentBookings = await prisma.booking.findMany({
    where: { ...bookingWhere, created_at: { gte: twelveMonthsAgo } },
    select: { 
      created_at: true,
      customer: { select: { is_repeat_customer: true } }
    }
  });

  // 1. Group by month for Sales Trend Chart
  const monthly_trend: any[] = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let maxMonthlyValue = 1; // Prevent division by zero
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = monthNames[d.getMonth()];
    const yearKey = d.getFullYear();
    
    const monthData = recentBookings.filter(b => b.created_at.getMonth() === d.getMonth() && b.created_at.getFullYear() === yearKey);
    const newUsers = monthData.filter(b => !b.customer?.is_repeat_customer).length;
    const existUsers = monthData.filter(b => b.customer?.is_repeat_customer).length;
    
    maxMonthlyValue = Math.max(maxMonthlyValue, newUsers, existUsers);
    
    monthly_trend.push({ month: monthKey, newVal: newUsers, existVal: existUsers });
  }
  
  // Calculate percentages based on max
  monthly_trend.forEach(m => {
    m.newPct = Math.min(95, (m.newVal / maxMonthlyValue) * 100);
    m.existPct = Math.min(95, (m.existVal / maxMonthlyValue) * 100);
  });

  // 1b. Monthly Invoice Revenue Trend (Last 12 Months)
  const recentInvoices = await prisma.invoice.findMany({
    where: { 
      status: 'Issued',
      issue_date: { gte: twelveMonthsAgo },
      ...(role === 'City Manager' && cityId ? { city_id: cityId } : {})
    },
    select: { 
      issue_date: true,
      final_amount: true,
      balance_due: true,
      amount_paid: true
    }
  });

  const monthly_revenue_trend: any[] = [];
  let maxRevenueValue = 1;
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = monthNames[d.getMonth()];
    const yearKey = d.getFullYear();
    
    const monthInvoices = recentInvoices.filter(inv => inv.issue_date && inv.issue_date.getMonth() === d.getMonth() && inv.issue_date.getFullYear() === yearKey);
    const revenue = monthInvoices.reduce((sum, inv) => sum + Number(inv.final_amount || 0), 0);
    const outstanding = monthInvoices.reduce((sum, inv) => sum + Number(inv.balance_due || 0), 0);
    const collections = monthInvoices.reduce((sum, inv) => sum + Number(inv.amount_paid || 0), 0);
    
    maxRevenueValue = Math.max(maxRevenueValue, revenue, outstanding, collections);
    
    monthly_revenue_trend.push({ month: monthKey, revenue, outstanding, collections });
  }

  monthly_revenue_trend.forEach(m => {
    m.revenuePct = maxRevenueValue > 1 ? Math.min(100, (m.revenue / maxRevenueValue) * 100) : 0;
    m.outstandingPct = maxRevenueValue > 1 ? Math.min(100, (m.outstanding / maxRevenueValue) * 100) : 0;
    m.collectionsPct = maxRevenueValue > 1 ? Math.min(100, (m.collections / maxRevenueValue) * 100) : 0;
  });

  // 2. Calculate 30-day Trends based on Bookings
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const bookingsThisMonth = recentBookings.filter(b => b.created_at >= thirtyDaysAgo).length;
  const bookingsLastMonth = recentBookings.filter(b => b.created_at >= sixtyDaysAgo && b.created_at < thirtyDaysAgo).length;
  const bookingsTrend = bookingsLastMonth > 0 ? ((bookingsThisMonth - bookingsLastMonth) / bookingsLastMonth) * 100 : (bookingsThisMonth > 0 ? 100 : 0);

  // 3. Generate Real Sparklines (last 6 months distribution)
  // Use ?? 0 (not || 1) — zero months must remain zero, no fake inflation
  const newSparkline = monthly_trend.slice(-6).map(m => m.newVal ?? 0);
  const existSparkline = monthly_trend.slice(-6).map(m => m.existVal ?? 0);

  return { 
    total_leads: totalLeads, 
    total_customers: totalCustomers, 
    active_bookings: activeBookings, 
    jobs_today: jobsToday,
    monthly_trend,
    monthly_revenue_trend,
    trends: {
      leads: null, // Leads table doesn't have created_at
      bookings: bookingsTrend > 0 ? `+${bookingsTrend.toFixed(1)}% this month` : `${bookingsTrend.toFixed(1)}% this month`,
      customers: bookingsTrend > 0 ? `+${bookingsTrend.toFixed(1)}% this month` : `${bookingsTrend.toFixed(1)}% this month`,
    },
    sparklines: {
      leads: newSparkline,
      bookings: existSparkline,
      customers: newSparkline,
    }
  };
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

  // Collect all unique actor user IDs to resolve real names in one query
  const allActorIds = [
    ...bookingHistory.map(h => h.changed_by),
    ...jobHistory.map(h => h.changed_by),
  ].filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

  const uniqueActorIds = [...new Set(allActorIds)];
  
  const userMap: Record<string, string> = {};
  if (uniqueActorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueActorIds } },
      select: { id: true, name: true }
    });
    users.forEach(u => { userMap[u.id] = u.name; });
  }

  const activities = [
    ...bookingHistory.map(h => ({
      type: 'booking' as const,
      ref: h.booking?.booking_id,
      actor: userMap[h.changed_by] || h.changed_by,
      from: h.from_status as string | null,
      to: h.to_status as string,
      at: h.changed_at,
      label: `Booking ${h.booking?.booking_id} → ${h.to_status}`,
    })),
    ...jobHistory.map(h => ({
      type: 'job' as const,
      ref: h.job?.job_id,
      actor: userMap[h.changed_by] || h.changed_by,
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

  const baseWhere: any = { status: 'Completed' };
  if (role === 'City Manager' && cityId) baseWhere.city_id = cityId;

  const [mtdResult, allTimeResult] = await Promise.all([
    prisma.booking.aggregate({
      where: { ...baseWhere, updated_at: { gte: mtdStart } },
      _sum: { final_amount: true },
      _count: { id: true },
    }),
    prisma.booking.aggregate({
      where: baseWhere,
      _sum: { final_amount: true },
      _count: { id: true },
    }),
  ]);

  return {
    mtd_revenue: mtdResult._sum.final_amount ?? 0,
    completed_bookings_count: mtdResult._count.id,
    all_time_revenue: allTimeResult._sum.final_amount ?? 0,
    all_time_completed: allTimeResult._count.id,
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

/**
 * Recent Completed Bookings for Transactions Table
 */
export const getRecentTransactions = async (role: string, cityId?: string, limit = 5) => {
  const where: any = { status: 'Completed' };
  if (role === 'City Manager' && cityId) where.city_id = cityId;

  return prisma.booking.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    take: limit,
    select: {
      id: true,
      booking_id: true,
      customer_name: true,
      service_name: true,
      status: true,
      final_amount: true,
      base_price: true,
      updated_at: true,
    }
  });
};

/**
 * Service Distribution — groups ALL bookings by service_name.
 * Returns count + percentage for every distinct service.
 * City Manager scoped to their city.
 */
export const getServiceDistribution = async (role: string, cityId?: string) => {
  const where: any = {};
  if (role === 'City Manager' && cityId) where.city_id = cityId;

  const groups = await prisma.booking.groupBy({
    by: ['service_name'],
    where,
    _count: { id: true },
    _sum: { final_amount: true },
    orderBy: { _count: { id: 'desc' } },
  });

  const total = groups.reduce((sum, g) => sum + g._count.id, 0);

  return groups.map(g => ({
    name: g.service_name || 'General Maintenance',
    count: g._count.id,
    revenue: Number(g._sum.final_amount || 0),
    pct: total > 0 ? Math.round((g._count.id / total) * 100) : 0,
  }));
};

