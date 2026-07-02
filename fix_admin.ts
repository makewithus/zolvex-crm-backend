import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.user.updateMany({
    data: { is_active: true }
  });
  console.log(`Unlocked ${result.count} users!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
