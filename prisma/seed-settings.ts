import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const defaults = [
    { key: 'company_registered_state', value: 'Maharashtra', label: 'Company Registered State' },
    { key: 'company_name',             value: 'Zolvex Services Pvt. Ltd.', label: 'Company Name' },
    { key: 'company_gstin',            value: '',            label: 'GSTIN' },
  ];

  for (const setting of defaults) {
    await prisma.systemSetting.upsert({
      where:  { key: setting.key },
      update: {},               // don't overwrite if already exists
      create: setting,
    });
    console.log(`✓ Seeded: ${setting.key} = "${setting.value}"`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
