import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('--- Checking existing tables in public schema ---');
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log(tables);

    console.log('\n--- Checking ENUMs ---');
    const enums = await prisma.$queryRaw`
      SELECT t.typname AS enum_name
      FROM pg_type t
      JOIN pg_enum e ON t.oid = e.enumtypid
      GROUP BY t.typname
      ORDER BY t.typname;
    `;
    console.log(enums);

  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
