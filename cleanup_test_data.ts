import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Cancel all test bookings (BKG-TEST-*) that are blocking real testing
  const result = await p.booking.updateMany({
    where: {
      booking_id: { startsWith: 'BKG-TEST-' },
      status: { notIn: ['Cancelled', 'Completed'] }
    },
    data: { status: 'Cancelled', cancel_reason: 'Stale test data cleanup', cancelled_at: new Date() }
  });

  console.log(`Cancelled ${result.count} test bookings.`);

  // Also show remaining active bookings for phone 7846666500
  const customer = await p.customer.findFirst({ where: { phone: '7846666500' } });
  if (customer) {
    const remaining = await p.booking.findMany({
      where: { customer_id: customer.id, status: { notIn: ['Cancelled', 'Completed'] } },
      select: { booking_id: true, status: true, scheduled_date: true }
    });
    console.log(`\nRemaining active bookings for this customer: ${remaining.length}`);
    remaining.forEach(b => console.log(`  ${b.booking_id} | ${b.status} | ${b.scheduled_date}`));
  }
}

main().finally(() => p.$disconnect());
