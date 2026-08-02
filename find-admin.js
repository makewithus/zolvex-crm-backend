const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find a user who is a Super Admin or similar
  const user = await prisma.user.findFirst({
    where: {
      role: {
        name: { in: ['Super Admin', 'City Manager'] }
      },
      is_active: true
    },
    select: {
      id: true,
      name: true,
      phone: true,
      role: { select: { name: true } }
    }
  });

  if (user) {
    console.log('\n--- FOUND VALID SYSTEM USER ---');
    console.log(`Name:  ${user.name}`);
    console.log(`Phone: ${user.phone}`);
    console.log(`Role:  ${user.role.name}`);
    console.log(`ID:    ${user.id}`);
    console.log('-------------------------------\n');
  } else {
    console.log('No active Super Admin or City Manager found in the database.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
