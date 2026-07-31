const { PrismaClient } = require('@prisma/client');

async function testConnection(url, name) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$connect();
    console.log(`[${name}] SUCCESS`);
    await prisma.$disconnect();
    return true;
  } catch(e) {
    console.log(`[${name}] FAILED: ${e.message}`);
    await prisma.$disconnect();
    return false;
  }
}

async function run() {
  const urls = [
    { name: 'Original', url: 'postgresql://neondb_owner:npg_SveHTaz81uNE@ep-small-sound-aol1ysxo-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' },
    { name: 'Direct', url: 'postgresql://neondb_owner:npg_SveHTaz81uNE@ep-small-sound-aol1ysxo.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' },
    { name: 'Original (no channel_binding)', url: 'postgresql://neondb_owner:npg_SveHTaz81uNE@ep-small-sound-aol1ysxo-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' },
    { name: 'Original (pgbouncer)', url: 'postgresql://neondb_owner:npg_SveHTaz81uNE@ep-small-sound-aol1ysxo-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&connect_timeout=15' },
    { name: 'Direct (no channel_binding)', url: 'postgresql://neondb_owner:npg_SveHTaz81uNE@ep-small-sound-aol1ysxo.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require' },
  ];

  for (const item of urls) {
    await testConnection(item.url, item.name);
  }
}

run();
