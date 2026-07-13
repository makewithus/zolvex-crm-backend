import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const cities = await prisma.city.findMany();
  console.log(cities);
}
main();
