const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.invoice.findMany({ select: { id: true, issue_date: true, status: true, final_amount: true } })
  .then(console.log)
  .finally(() => prisma.$disconnect());
