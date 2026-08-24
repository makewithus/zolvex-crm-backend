const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function verify() {
  const nullRows = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int as null_count FROM "Lead" WHERE created_at IS NULL'
  );
  console.log('Rows with NULL created_at:', nullRows[0].null_count);

  const total = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int as total FROM "Lead"'
  );
  console.log('Total Lead rows:', total[0].total);

  const sample = await prisma.$queryRawUnsafe(
    'SELECT id, phone, status, created_at FROM "Lead" ORDER BY created_at DESC LIMIT 5'
  );
  console.log('Sample (newest first):');
  sample.forEach(r => console.log(' ', r.id.slice(0,8), r.phone, r.status, r.created_at));

  await prisma.$disconnect();
}

verify().catch(e => { console.error(e); process.exit(1); });
