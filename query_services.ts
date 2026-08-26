import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const services = await prisma.service.findMany();
  console.log('Services:\n', JSON.stringify(services, null, 2));
}
run().finally(() => prisma.$disconnect());
