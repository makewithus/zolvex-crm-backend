import { PrismaClient } from '@prisma/client';
import * as dispatchService from './src/services/dispatch.service';
import * as jobService from './src/services/job.service';
import { checkAvailability } from './src/services/technician-availability.service';
import fs from 'fs';

const prisma = new PrismaClient();
let report = '# Phase 5: Calendar Infrastructure Verification Report\n\n';

async function log(msg: string) {
  console.log(msg);
  report += msg + '\n';
}

async function run() {
  await log("## 1. Verifying Optimistic Concurrency Control (OCC)");
  
  // Setup
  const role = await prisma.role.findFirst({ where: { name: 'Field Staff' } });
  const userRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
  
  const customer = await prisma.customer.create({ data: { phone: '9998887776', name: 'OCC Test Customer' } });
  const city = await prisma.city.create({ data: { name: 'OCC City' } });
  const service = await prisma.service.create({ data: { name: 'OCC Service', base_price: 100 } });
  const admin = await prisma.user.create({ data: { name: 'Admin', phone: '1111111112', role_id: userRole!.id, password_hash: '123' } });
  const tech1 = await prisma.user.create({ data: { name: 'Tech 1', phone: '1111111113', role_id: role!.id, password_hash: '123', city_id: city.id } });
  const tech2 = await prisma.user.create({ data: { name: 'Tech 2', phone: '1111111114', role_id: role!.id, password_hash: '123', city_id: city.id } });

  const booking = await prisma.booking.create({
    data: {
      booking_id: 'B-OCC-1',
      customer_id: customer.id,
      city_id: city.id,
      service_id: service.id,
      scheduled_date: new Date(),
      customer_phone: customer.phone,
      address_line_1: 'test',
      city_name: 'test',
      postal_code: '123',
      state: 'test',
      service_name: 'OCC',
      base_price: 100,
      final_amount: 100,
      created_by: admin.id
    }
  });

  const job = await jobService.createJobFromBooking(booking.id, admin.id);
  const fetchedJob = await prisma.job.findUnique({ where: { id: job.id } });
  const initialVersion = fetchedJob!.updated_at.toISOString();

  await log(`- Initial Job Version Token: ${initialVersion}`);

  // Dispatcher B updates Job
  await dispatchService.rescheduleJob(job.id, new Date(Date.now() + 86400000).toISOString(), admin.id, initialVersion);
  await log("- Dispatcher B successfully rescheduled the job.");

  // Dispatcher A submits stale version
  try {
    await dispatchService.assignTechnician(job.id, tech1.id, admin.id, initialVersion, false);
    await log("❌ FAILED: Stale update went through!");
  } catch (e: any) {
    await log(`✅ PASSED: Stale update rejected. Error: "${e.message}"`);
  }

  await log("\n## 2. Verifying Technician Availability Service");
  
  const targetTime = new Date();
  targetTime.setHours(14, 0, 0, 0); // 2 PM
  
  // Test: Same City (Tech1 is in OCC City)
  let avail = await checkAvailability(tech1.id, city.id, targetTime, 60);
  await log(`- Same City check: ${avail.available ? 'AVAILABLE' : 'UNAVAILABLE'} (Expected AVAILABLE)`);
  
  // Test: Different City
  const otherCity = await prisma.city.create({ data: { name: 'Other City' } });
  avail = await checkAvailability(tech1.id, otherCity.id, targetTime, 60);
  await log(`- Different City check: ${avail.available ? 'AVAILABLE' : 'UNAVAILABLE'} - Reason: ${avail.reason}`);
  
  // Setup: Overlapping Job
  // Fetch fresh job token
  const freshJob = await prisma.job.findUnique({ where: { id: job.id } });
  // Reschedule to 2 PM
  await dispatchService.rescheduleJob(job.id, targetTime.toISOString(), admin.id, freshJob!.updated_at.toISOString());
  const freshJob2 = await prisma.job.findUnique({ where: { id: job.id } });
  // Assign Tech1
  await dispatchService.assignTechnician(job.id, tech1.id, admin.id, freshJob2!.updated_at.toISOString(), false);
  
  // Test: Overlapping Job (Trying to schedule Tech1 at 2:30 PM for 60 mins)
  const overlapTime = new Date(targetTime.getTime() + 30 * 60000); // 2:30 PM
  avail = await checkAvailability(tech1.id, city.id, overlapTime, 60);
  await log(`- Overlapping Job check: ${avail.available ? 'AVAILABLE' : 'UNAVAILABLE'} - Reason: ${avail.reason}`);
  
  // Test: Working Hours (22:00 / 10 PM)
  const lateTime = new Date(targetTime);
  lateTime.setHours(22, 0, 0, 0);
  avail = await checkAvailability(tech2.id, city.id, lateTime, 60);
  // We didn't strictly block working hours in the code (it's commented for a soft warning), but we can log it.
  await log(`- Late Working Hours check (22:00): ${avail.available ? 'AVAILABLE' : 'UNAVAILABLE'}`);

  await log("\n## 3. Verifying KPIs");
  // We have 1 job scheduled today (actually we rescheduled job.id to targetTime which is today 2PM).
  // It is assigned to tech1. So it is Assigned. (Not running).
  const startDate = new Date();
  startDate.setHours(0,0,0,0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  const filters = {};
  const jobs = await jobService.getJobsByDateRange(startDate.toISOString(), endDate.toISOString(), filters);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const kpis = { total_today: 0, unassigned: 0, running: 0, delayed: 0, completed: 0, cancelled: 0 };
  const now = new Date();

  jobs.forEach((j: any) => {
    const jobDate = new Date(j.scheduled_start);
    const isToday = jobDate >= today && jobDate < tomorrow;
    if (isToday) {
      kpis.total_today++;
      if (!j.assigned_user_id) kpis.unassigned++;
      if (['Travelling', 'Arrived', 'Started'].includes(j.status)) kpis.running++;
      if (j.status === 'Completed') kpis.completed++;
      if (j.status === 'Cancelled') kpis.cancelled++;
      if (['Pending', 'Assigned', 'Accepted'].includes(j.status)) {
        const threshold = new Date(jobDate.getTime() + 30 * 60000);
        if (now > threshold) kpis.delayed++;
      }
    }
  });

  await log(JSON.stringify(kpis, null, 2));

  // Teardown
  await prisma.jobHistory.deleteMany({ where: { job_id: job.id } });
  await prisma.jobAssignmentHistory.deleteMany({ where: { job_id: job.id } });
  await prisma.job.delete({ where: { id: job.id } });
  await prisma.bookingHistory.deleteMany({ where: { booking_id: booking.id } });
  await prisma.booking.delete({ where: { id: booking.id } });
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, tech1.id, tech2.id] } } });
  await prisma.city.deleteMany({ where: { id: { in: [city.id, otherCity.id] } } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.service.delete({ where: { id: service.id } });

  fs.writeFileSync('phase_5_infrastructure_verification_report.md', report);
  console.log("Done.");
}

run().catch(console.error);
