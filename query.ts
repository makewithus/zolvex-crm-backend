import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const services = await prisma.service.findMany();
  console.log('Services:', services);
  const cities = await prisma.city.findMany();
  console.log('Cities:', cities);
}
run().finally(() => prisma.$disconnect());
