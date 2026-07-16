const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.booking.findMany({ select: { scheduled_date: true, final_amount: true, status: true } })
  .then(console.log)
  .finally(() => prisma.$disconnect());
