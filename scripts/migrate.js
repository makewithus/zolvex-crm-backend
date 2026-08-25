const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log("Executing SQL migration...");
    await prisma.$executeRawUnsafe(`ALTER TABLE "Lead" ADD COLUMN "service_location" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Lead" ADD COLUMN "follow_up_date" TIMESTAMP(3);`);
    console.log("Migration executed successfully.");
    
    console.log("Verifying columns...");
    const columns = await prisma.$queryRaw`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'Lead' AND column_name IN ('service_location', 'follow_up_date')
    `;
    console.log(JSON.stringify(columns, null, 2));

    console.log("Verifying existing leads have NULL...");
    const nullCheck = await prisma.$queryRaw`
      SELECT COUNT(*) as non_null_count
      FROM "Lead"
      WHERE "service_location" IS NOT NULL OR "follow_up_date" IS NOT NULL
    `;
    // BigInt serialization issue in JSON stringify, so we just log it directly
    console.log("Non-null count:", nullCheck[0].non_null_count.toString());

  } catch (err) {
    console.error("Migration Failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
