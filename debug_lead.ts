import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const lead = await p.lead.findFirst({
    where: { name: 'tt' },
    include: {
      customer: {
        include: {
          bookings: {
            where: { status: { notIn: ['Cancelled', 'Completed'] } },
            orderBy: { created_at: 'desc' },
            select: { booking_id: true, status: true, scheduled_date: true, service_name: true, id: true }
          }
        }
      }
    }
  });

  if (!lead) { console.log('No lead named "tt" found'); return; }

  console.log('\n=== Lead ===');
  console.log('Name:', lead.name, '| Phone:', lead.phone, '| Status:', lead.status);
  console.log('Customer ID:', lead.customer_id);

  console.log('\n=== Active Bookings for this Customer ===');
  if (!lead.customer?.bookings?.length) {
    console.log('None found — this should not block conversion.');
  } else {
    lead.customer.bookings.forEach(b => {
      console.log(`  ${b.booking_id} | ${b.service_name} | ${b.scheduled_date} | ${b.status}`);
    });
  }
}

main().finally(() => p.$disconnect());
