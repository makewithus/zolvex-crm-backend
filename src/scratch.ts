import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const allBookings = await prisma.booking.findMany({
    select: {
      id: true,
      booking_id: true,
      status: true,
      completed_at: true,
      final_amount: true,
      created_at: true
    }
  });
  
  console.log("Total Bookings:", allBookings.length);
  
  const completed = allBookings.filter(b => b.status === 'Completed');
  console.log("Completed Bookings:", completed.length);
  console.dir(completed, { depth: null });
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
