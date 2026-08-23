import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const globalSearch = async (query: string) => {
  const q = query.trim();
  if (q.length < 2) {
    return { customers: [], leads: [], bookings: [], invoices: [] };
  }

  const [customers, leads, bookings, invoices] = await Promise.all([
    prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      select: { id: true, name: true, phone: true },
    }),
    prisma.lead.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      select: { id: true, name: true, phone: true, status: true },
    }),
    prisma.booking.findMany({
      where: { booking_id: { startsWith: q, mode: 'insensitive' } },
      take: 5,
      select: { id: true, booking_id: true, customer_name: true, status: true },
    }),
    prisma.invoice.findMany({
      where: { invoice_number: { startsWith: q, mode: 'insensitive' } },
      take: 5,
      select: { id: true, invoice_number: true, customer_name: true, status: true },
    }),
  ]);

  return { customers, leads, bookings, invoices };
};
