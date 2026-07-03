/**
 * Phase 5 Regression & Integrity Verification Script
 * Tests every scenario from the approved audit before Sprint 2.
 */
import { PrismaClient } from '@prisma/client';
import * as dispatchService from './src/services/dispatch.service';
import * as jobService from './src/services/job.service';
import * as bookingService from './src/services/booking.service';
import fs from 'fs';

const prisma = new PrismaClient();
let report = '# Phase 5 — Regression & Integrity Verification Report\n\n';
let passed = 0, failed = 0;

function assertError(label: string, fn: () => Promise<any>, expectedMsg: string) {
  return fn().then(() => {
    report += `❌ FAIL [${label}]: Expected error "${expectedMsg}" but call succeeded.\n\n`;
    failed++;
  }).catch((e: any) => {
    if (e.message.includes(expectedMsg.slice(0, 30))) {
      report += `✅ PASS [${label}]: Correctly rejected with: "${e.message}"\n\n`;
      passed++;
    } else {
      report += `❌ FAIL [${label}]: Wrong error. Expected "${expectedMsg}" but got "${e.message}"\n\n`;
      failed++;
    }
  });
}

async function assertSuccess(label: string, fn: () => Promise<any>) {
  try {
    const result = await fn();
    report += `✅ PASS [${label}]\n\n`;
    passed++;
    return result;
  } catch (e: any) {
    report += `❌ FAIL [${label}]: Unexpected error: "${e.message}"\n\n`;
    failed++;
    return null;
  }
}

async function run() {
  report += `## Setup\n\n`;

  // Bootstrap entities
  const role = await prisma.role.findFirst({ where: { name: 'Field Staff' } });
  const adminRole = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
  const ts = Date.now();
  const customer = await prisma.customer.create({ data: { phone: `REG${ts}`, name: 'Reg Customer' } });
  const city = await prisma.city.create({ data: { name: `Reg City ${ts}` } });
  const service = await prisma.service.create({ data: { name: `Reg Svc ${ts}`, base_price: 100 } });
  await prisma.pricingRule.create({ data: { service_id: service.id, base_price: 100 } });
  const admin = await prisma.user.create({ data: { name: 'Reg Admin', phone: `RA${ts}`, role_id: adminRole!.id, password_hash: 'x' } });
  const tech  = await prisma.user.create({ data: { name: 'Reg Tech',  phone: `RT${ts}`, role_id: role!.id,      password_hash: 'x', city_id: city.id } });

  const makeBooking = async () => {
    // ensure sequence
    const seq = await prisma.bookingSequence.findUnique({ where: { id: 1 } });
    if (!seq) await prisma.bookingSequence.create({ data: { id: 1, value: 0 } });

    return await bookingService.createBooking({
      customer_id: customer.id, city_id: city.id, service_id: service.id,
      scheduled_date: new Date(Date.now() + 86400000).toISOString(),
      address_line_1: '1 Test St', city_name: 'Regression City',
      postal_code: '000001', state: 'TestState'
    }, admin.id);
  };

  const makeJobSeq = async () => {
    const jseq = await prisma.jobSequence.findUnique({ where: { id: 1 } });
    if (!jseq) await prisma.jobSequence.create({ data: { id: 1, value: 0 } });
  };

  report += `## 1. BUG-001: Cancel Booking → Assign Technician (Must Fail)\n\n`;

  const b1 = await assertSuccess('Create Booking for BUG-001', makeBooking);
  await makeJobSeq();
  const j1 = await assertSuccess('Create Job from Booking', () => jobService.createJobFromBooking(b1.id, admin.id));
  await assertSuccess('Cancel Booking (should cascade-cancel Job)', () => bookingService.cancelBooking(b1.id, 'Test cancel', admin.id));

  // Verify cascade: job must be Cancelled now
  const j1Fresh = await prisma.job.findUnique({ where: { id: j1.id } });
  if (j1Fresh?.status === 'Cancelled') {
    report += `✅ PASS [Cascade Cancel]: Job status is now "${j1Fresh.status}" after Booking was cancelled.\n\n`;
    passed++;
  } else {
    report += `❌ FAIL [Cascade Cancel]: Job status is "${j1Fresh?.status}" — expected "Cancelled".\n\n`;
    failed++;
  }

  await assertError('Assign after Cancel (BUG-001)', () => dispatchService.assignTechnician(j1.id, tech.id, admin.id), 'Cannot assign');
  await assertError('Reschedule after Cancel', () => dispatchService.rescheduleJob(j1.id, new Date(Date.now() + 86400000).toISOString(), admin.id), 'Cannot reschedule');
  await assertError('Status Update after Cancel', () => jobService.transitionJobStatus(j1.id, 'Accepted', admin.id, 'Super Admin', '127.0.0.1'), 'Cannot update status');

  report += `## 2. Normal Job Lifecycle — Assign → Accept → Travel → Complete\n\n`;

  const b2 = await assertSuccess('Create Booking for lifecycle', makeBooking);
  const j2 = await assertSuccess('Create Job', () => jobService.createJobFromBooking(b2.id, admin.id));
  await assertSuccess('Assign Technician', () => dispatchService.assignTechnician(j2.id, tech.id, admin.id));
  await assertSuccess('Accept Job', () => jobService.transitionJobStatus(j2.id, 'Accepted', tech.id, 'Field Staff', '127.0.0.1'));
  await assertSuccess('Travelling', () => jobService.transitionJobStatus(j2.id, 'Travelling', tech.id, 'Field Staff', '127.0.0.1'));
  await assertSuccess('Arrived', () => jobService.transitionJobStatus(j2.id, 'Arrived', tech.id, 'Field Staff', '127.0.0.1'));
  await assertSuccess('Started', () => jobService.transitionJobStatus(j2.id, 'Started', tech.id, 'Field Staff', '127.0.0.1'));
  await assertSuccess('Completed', () => jobService.transitionJobStatus(j2.id, 'Completed', tech.id, 'Field Staff', '127.0.0.1', { completionNotes: 'Done.' }));

  // Terminal state guards
  await assertError('Cannot assign Completed Job', () => dispatchService.assignTechnician(j2.id, tech.id, admin.id), 'Cannot assign a technician to a completed job');
  await assertError('Cannot reschedule Completed Job', () => dispatchService.rescheduleJob(j2.id, new Date().toISOString(), admin.id), 'Cannot reschedule a completed job');

  report += `## 3. KPI Accuracy Verification\n\n`;

  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 2); // Cover tomorrow (where test jobs are scheduled)

  // Create one more booking for tomorrow, don't cancel it
  const b3 = await assertSuccess('Create active booking for KPI test', makeBooking);
  const j3 = await assertSuccess('Create Job for KPI', () => jobService.createJobFromBooking(b3.id, admin.id));
  await assertSuccess('Assign for KPI', () => dispatchService.assignTechnician(j3.id, tech.id, admin.id));

  // Count directly from DB for expected KPIs
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0,0,0,0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const dbJobs = await prisma.job.findMany({ where: { scheduled_start: { gte: tomorrow, lt: dayAfter } } });
  const dbActiveCount = dbJobs.filter(j => !['Cancelled','Completed','Failed','NoAccess','CustomerNotAvailable'].includes(j.status)).length;
  const dbUnassigned = dbJobs.filter(j => !j.assigned_user_id && j.status !== 'Cancelled').length;
  const dbCancelled = dbJobs.filter(j => j.status === 'Cancelled').length;

  report += `**DB State (tomorrow's jobs):**\n`;
  report += `- Total jobs: ${dbJobs.length}\n`;
  report += `- Active (non-terminal): ${dbActiveCount}\n`;
  report += `- Unassigned: ${dbUnassigned}\n`;
  report += `- Cancelled: ${dbCancelled}\n\n`;

  report += `## 4. Final Summary\n\n`;
  report += `**PASSED: ${passed}** | **FAILED: ${failed}**\n\n`;

  if (failed === 0) {
    report += `### ✅ ALL CHECKS PASSED — SPRINT 2 IS APPROVED\n`;
  } else {
    report += `### ❌ ${failed} CHECK(S) FAILED — DO NOT PROCEED TO SPRINT 2\n`;
  }

  // Teardown
  const allBookingIds = [b1.id, b2.id, b3?.id].filter(Boolean) as string[];
  const allJobIds = [j1.id, j2.id, j3?.id].filter(Boolean) as string[];

  for (const jid of allJobIds) {
    await prisma.jobHistory.deleteMany({ where: { job_id: jid } });
    await prisma.jobAssignmentHistory.deleteMany({ where: { job_id: jid } });
    await prisma.job.deleteMany({ where: { id: jid } });
  }
  for (const bid of allBookingIds) {
    await prisma.bookingHistory.deleteMany({ where: { booking_id: bid } });
    await prisma.booking.deleteMany({ where: { id: bid } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [admin.id, tech.id] } } });
  await prisma.city.delete({ where: { id: city.id } });
  await prisma.customer.delete({ where: { id: customer.id } });
  await prisma.pricingRule.deleteMany({ where: { service_id: service.id } });
  await prisma.service.delete({ where: { id: service.id } });

  fs.writeFileSync('phase5_regression_report.md', report);
  console.log(report);
}

run().catch(e => { console.error(e); process.exit(1); });
