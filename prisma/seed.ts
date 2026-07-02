import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const roles = [
    'Super Admin',
    'City Manager',
    'Support Agent',
    'Field Staff',
    'Finance',
  ];

  for (const roleName of roles) {
    await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });
  }
  console.log('Seed: 5 system roles verified.');

  const superAdminRole = await prisma.role.findUnique({
    where: { name: 'Super Admin' }
  });

  if (superAdminRole) {
    const phone = '9999999999';
    const passwordHash = await bcrypt.hash('admin123', 10);

    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        name: 'System Admin',
        phone,
        password_hash: passwordHash,
        role_id: superAdminRole.id
      }
    });
    console.log('Seed: Super Admin user verified.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
