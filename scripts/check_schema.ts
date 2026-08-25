import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSchema() {
  try {
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Lead'
    `;
    console.log("Columns in the live Lead table:");
    console.log(result);
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkSchema();
