import { PrismaClient, JobStatus } from '@prisma/client';
import * as jobService from './src/services/job.service';
import * as dispatchService from './src/services/dispatch.service';
import * as bookingService from './src/services/booking.service';

const prisma = new PrismaClient();

async function run() {
  console.log('====================================');
  console.log('PHASE 4 JOBS & DISPATCH VERIFICATION');
  console.log('====================================\n');

  try {
    // 1. SETUP PREREQUISITES
    console.log('--- 0. SETUP ---');
    const superAdmin = await prisma.user.findFirst({ where: { role: { name: 'Super Admin' } } });
    if (!superAdmin) throw new Error("Super Admin not found");

    const city = await prisma.city.findFirst();
    const service = await prisma.service.findFirst();
    const customer = await prisma.customer.findFirst();
    
    if (!city || !service || !customer) throw new Error("Missing required basic master data");

    // Ensure we have a Field Staff user in the same city
    let tech = await prisma.user.findFirst({ where: { role: { name: 'Field Staff' }, city_id: city.id } });
    if (!tech) {
       const techRole = await prisma.role.findFirst({ where: { name: 'Field Staff' } });
       tech = await prisma.user.create({
         data: {
            name: 'Test Tech',
            phone: '5551112222',
            password_hash: 'hash',
            role_id: techRole!.id,
            city_id: city.id,
            is_active: true
         }
       });
    }

    // Create a new Booking for this test to ensure clean state
    const pricingRule = await prisma.pricingRule.findFirst();
    
    console.log('Creating Test Booking...');
    const booking = await prisma.booking.create({
      data: {
        booking_id: `BKG-TEST-${Date.now()}`,
        customer_id: customer.id,
        city_id: city.id,
        service_id: service.id,
        pricing_rule_id: pricingRule?.id,
        scheduled_date: new Date(Date.now() + 86400000), // Tomorrow
        customer_name: customer.name,
        customer_phone: customer.phone,
        address_line_1: '123 Test St',
        city_name: city.name,
        postal_code: '12345',
        state: 'Test State',
        country: 'India',
        service_name: service.name,
        base_price: 100,
        final_amount: 100,
        created_by: superAdmin.id,
        status: 'Confirmed'
      }
    });

    console.log(`✅ Test Booking created: ${booking.booking_id}\n`);

    // 2. CREATE JOB FROM BOOKING
    console.log('--- 1. CREATE JOB FROM BOOKING ---');
    let job: any = await jobService.createJobFromBooking(booking.id, superAdmin.id, 'High');
    console.log(`✅ Job created: ${job.job_id}`);
    console.log(`Job Status: ${job.status}, Booking ID: ${job.booking_id}\n`);

    // 3. DUPLICATE JOB PREVENTION
    console.log('--- 2. DUPLICATE JOB PREVENTION ---');
    try {
      await jobService.createJobFromBooking(booking.id, superAdmin.id, 'High');
      console.log('❌ FAILED: Duplicate job was created.');
    } catch (e: any) {
      console.log(`✅ SUCCESS: Duplicate job rejected. Reason: ${e.message}\n`);
    }

    // 4. ASSIGN TECHNICIAN (OVERLAP ALGORITHM)
    console.log('--- 3. ASSIGN TECHNICIAN ---');
    // First Assignment
    await dispatchService.assignTechnician(job.id, tech.id, superAdmin.id);
    job = (await prisma.job.findUnique({ where: { id: job.id }, include: { booking: true } })) as any;
    console.log(`✅ Job assigned to Tech: ${tech.name}`);
    console.log(`Job Status: ${job.status}, Booking Status: ${job.booking?.status}`);
    
    const assignmentHistory = await prisma.jobAssignmentHistory.findMany({ where: { job_id: job.id } });
    console.log(`Job Assignment History Rows: ${assignmentHistory.length}\n`);

    // 5. ILLEGAL TRANSITION VERIFICATION
    console.log('--- 4. ILLEGAL TRANSITIONS ---');
    try {
      await jobService.transitionJobStatus(job.id, 'Completed', tech.id, 'Field Staff');
      console.log('❌ FAILED: Field Staff skipped to Completed.');
    } catch (e: any) {
      console.log(`✅ SUCCESS: Illegal progression rejected. Reason: ${e.message}\n`);
    }

    // 6. VALID STATE PROGRESSION & BOOKING SYNC
    console.log('--- 5. VALID STATE PROGRESSION & BOOKING SYNC ---');
    
    // Accept
    job = await jobService.transitionJobStatus(job.id, 'Accepted', tech.id, 'Field Staff');
    console.log(`✅ Tech Accepted Job. Status: ${job.status}`);

    // Travel
    job = await jobService.transitionJobStatus(job.id, 'Travelling', tech.id, 'Field Staff');
    let syncBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    console.log(`✅ Tech Travelling. Job Status: ${job.status} -> Booking Status: ${syncBooking?.status}`);

    // Arrive
    job = await jobService.transitionJobStatus(job.id, 'Arrived', tech.id, 'Field Staff');
    console.log(`✅ Tech Arrived. Job Status: ${job.status}`);

    // Start
    job = await jobService.transitionJobStatus(job.id, 'Started', tech.id, 'Field Staff');
    syncBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    console.log(`✅ Tech Started. Job Status: ${job.status} -> Booking Status: ${syncBooking?.status}`);
    console.log(`Actual Start Timestamp: ${job.actual_start}`);

    // 7. COMPLETION RULES
    console.log('\n--- 6. COMPLETION RULES ---');
    try {
      await jobService.transitionJobStatus(job.id, 'Completed', tech.id, 'Field Staff');
      console.log('❌ FAILED: Completed without notes.');
    } catch (e: any) {
      console.log(`✅ SUCCESS: Completion rejected without notes. Reason: ${e.message}`);
    }

    job = await jobService.transitionJobStatus(job.id, 'Completed', tech.id, 'Field Staff', undefined, { completionNotes: 'Fixed the issue' });
    syncBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
    console.log(`✅ Job Completed successfully!`);
    console.log(`Job Status: ${job.status} -> Booking Status: ${syncBooking?.status}`);
    console.log(`Actual End Timestamp: ${job.actual_end}`);
    console.log(`Completion Notes: ${job.completion_notes}\n`);

    // 8. JOB HISTORY AUDIT
    console.log('--- 7. JOB HISTORY AUDIT ---');
    const jobHistory = await prisma.jobHistory.findMany({ where: { job_id: job.id }, orderBy: { changed_at: 'asc' } });
    console.log(`Job History Rows: ${jobHistory.length}`);
    jobHistory.forEach(h => console.log(` - ${h.from_status} -> ${h.to_status} (by ${h.changed_by_role || 'System'})`));
    console.log('\n====================================');
    console.log('RUNTIME VERIFICATION COMPLETED SUCCESSFULLY');
    console.log('====================================');

  } catch (error: any) {
    console.error('VERIFICATION FAILED:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

run();
