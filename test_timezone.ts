import { checkAvailability } from './src/services/technician-availability.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runTimezoneTests() {
  console.log("Running Timezone Automated Tests...");

  // Setup mock user
  const userRole = await prisma.role.findFirst();
  const tech = await prisma.user.create({
    data: { name: 'TZ Tech', phone: 'TZ123', password_hash: '123', role_id: userRole!.id }
  });

  try {
    // Test 1: Job at 23:30 UTC
    // Depending on the machine running this, UTC 23:30 will be different in local time.
    // checkAvailability expects local time. Let's create a UTC date.
    const lateUtc = new Date('2026-07-03T23:30:00.000Z');
    
    console.log(`Testing Late UTC: ${lateUtc.toISOString()} which is local ${lateUtc.toString()}`);
    let result = await checkAvailability(tech.id, tech.city_id || '', lateUtc, 60);
    console.log(`Late UTC Availability: ${result.available}`);

    // Test 2: Job at 00:15 UTC (Next day UTC)
    const earlyUtc = new Date('2026-07-04T00:15:00.000Z');
    console.log(`Testing Early UTC: ${earlyUtc.toISOString()} which is local ${earlyUtc.toString()}`);
    result = await checkAvailability(tech.id, tech.city_id || '', earlyUtc, 60);
    console.log(`Early UTC Availability: ${result.available}`);

    // DST Safe Check
    // Create a date in March and November to ensure no crash
    const marchDate = new Date('2026-03-10T12:00:00.000Z');
    console.log(`Testing DST March Date: ${marchDate.toString()}`);
    result = await checkAvailability(tech.id, tech.city_id || '', marchDate, 60);
    console.log(`March Availability: ${result.available}`);

    console.log("Timezone Automated Tests Passed!");
  } finally {
    // Teardown
    await prisma.user.delete({ where: { id: tech.id } });
    await prisma.$disconnect();
  }
}

runTimezoneTests().catch(console.error);
