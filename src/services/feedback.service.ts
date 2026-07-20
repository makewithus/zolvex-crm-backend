/**
 * FEEDBACK SERVICE
 * Simple CRUD for customer feedback (rating + comment).
 * Purely informational. Does NOT affect any business workflow.
 */

import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export interface CreateFeedbackInput {
  customer_id: string;
  booking_id?: string;
  job_id?: string;
  rating: number;        // 1–5
  comment?: string;
  submitted_by: string;
}

export const createFeedback = async (data: CreateFeedbackInput) => {
  if (data.rating < 1 || data.rating > 5 || !Number.isInteger(data.rating)) {
    throw new AppError('Rating must be an integer between 1 and 5', 400);
  }

  // Validate the customer exists
  const customer = await prisma.customer.findUnique({ where: { id: data.customer_id }, select: { id: true } });
  if (!customer) throw new AppError('Customer not found', 404);

  return prisma.customerFeedback.create({
    data: {
      customer_id:  data.customer_id,
      booking_id:   data.booking_id,
      job_id:       data.job_id,
      rating:       data.rating,
      comment:      data.comment,
      submitted_by: data.submitted_by,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      booking:  { select: { id: true, booking_id: true } },
      job:      { select: { id: true, job_id: true } },
    }
  });
};

export const getFeedbacks = async (filters: { customer_id?: string; booking_id?: string; rating?: number }) => {
  const where: any = {};
  if (filters.customer_id) where.customer_id = filters.customer_id;
  if (filters.booking_id)  where.booking_id  = filters.booking_id;
  if (filters.rating)      where.rating      = Number(filters.rating);

  return prisma.customerFeedback.findMany({
    where,
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      booking:  { select: { id: true, booking_id: true } },
      job:      { select: { id: true, job_id: true } },
    },
    orderBy: { created_at: 'desc' }
  });
};

export const getFeedbackById = async (id: string) => {
  const fb = await prisma.customerFeedback.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      booking:  { select: { id: true, booking_id: true } },
      job:      { select: { id: true, job_id: true } },
    }
  });
  if (!fb) throw new AppError('Feedback not found', 404);
  return fb;
};

export const getFeedbackStats = async () => {
  const [count, avg, distribution] = await Promise.all([
    prisma.customerFeedback.count(),
    prisma.customerFeedback.aggregate({ _avg: { rating: true } }),
    prisma.customerFeedback.groupBy({
      by: ['rating'],
      _count: { rating: true },
      orderBy: { rating: 'asc' }
    })
  ]);
  return {
    total: count,
    average_rating: avg._avg.rating ? Number(avg._avg.rating.toFixed(2)) : null,
    distribution: distribution.map(d => ({ rating: d.rating, count: d._count.rating }))
  };
};
