const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const roles = await prisma.role.findMany();
  console.log(roles);
  await prisma.$disconnect();
}
run();
