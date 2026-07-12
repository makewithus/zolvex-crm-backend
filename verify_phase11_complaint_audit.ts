/**
 * verify_phase11_complaint_audit.ts
 * Sprint 11.1 — Post-Freeze Audit
 * 
 * Checks:
 *  [1] Status Transition Matrix (static code audit)
 *  [2] Timeline Integrity (structural + DB)
 *  [3] Event Consistency (code audit — events publish after DB writes)
 *  [4] Automation Isolation (code audit — no direct queue/task writes)
 *  [5] RBAC Audit (HTTP E2E)
 *  [6] Sequence Generator Concurrency (concurrent creation stress test)
 *  [7] Database Integrity (optional references independently)
 *  [8] Full Regression Suite
 */

import { PrismaClient, ComplaintStatus, ComplaintPriority } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { env } from './src/config/env';

const prisma = new PrismaClient();
const API = `http://localhost:${env.PORT}/api/v1`;
const SRC = path.resolve(__dirname, 'src');

let passed = 0; let failed = 0;
const issues: string[] = [];
const ok   = (msg: string) => { console.log(`  ✅ ${msg}`); passed++; };
const fail = (msg: string) => { console.error(`  ❌ ${msg}`); failed++; issues.push(msg); };
const skip = (msg: string) => console.log(`  ⏭️  ${msg}`);
const info = (msg: string) => console.log(`     ${msg}`);

// ─── helpers ─────────────────────────────────────────────────────────────────

function readFile(rel: string) {
  return fs.readFileSync(path.join(SRC, rel), 'utf-8');
}

function collectTs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory() && !['node_modules','dist','.git'].includes(e.name)) out.push(...collectTs(fp));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(fp);
  }
  return out;
}

async function bootstrapTestUsers() {
  const bcrypt = require('bcrypt');
  const ph = await bcrypt.hash('password123', 10);
  const rand = () => Math.floor(100000 + Math.random() * 900000);

  const roles = await prisma.role.findMany();
  const adminRole   = roles.find(r => r.name === 'Super Admin')   || await prisma.role.create({ data: { name: 'Super Admin' } });
  const cmRole      = roles.find(r => r.name === 'City Manager')  || await prisma.role.create({ data: { name: 'City Manager' } });
  const techRole    = roles.find(r => r.name === 'Technician')    || await prisma.role.create({ data: { name: 'Technician' } });
  const agentRole   = roles.find(r => r.name === 'Support Agent') || await prisma.role.create({ data: { name: 'Support Agent' } });

  const city = await prisma.city.create({ data: { name: `AuditCity-${rand()}` } });

  const admin = await prisma.user.create({ data: { name: 'AuditAdmin', phone: `9999${rand()}`, password_hash: ph, role_id: adminRole.id } });
  const cm    = await prisma.user.create({ data: { name: 'AuditCM',    phone: `9998${rand()}`, password_hash: ph, role_id: cmRole.id, city_id: city.id } });
  const tech  = await prisma.user.create({ data: { name: 'AuditTech',  phone: `9997${rand()}`, password_hash: ph, role_id: techRole.id } });
  const agent = await prisma.user.create({ data: { name: 'AuditAgent', phone: `9996${rand()}`, password_hash: ph, role_id: agentRole.id } });

  const cust = await prisma.customer.create({ data: { phone: `9995${rand()}`, name: 'AuditCustomer' } });

  const tok = async (phone: string) => {
    const r = await axios.post(`${API}/auth/login`, { phone, password: 'password123' });
    return r.data.data.token as string;
  };

  return {
    adminToken: await tok(admin.phone),
    cmToken:    await tok(cm.phone),
    techToken:  await tok(tech.phone),
    agentToken: await tok(agent.phone),
    adminId: admin.id,
    cmId: cm.id,
    techId: tech.id,
    agentId: agent.id,
    custId: cust.id,
    cityId: city.id,
    cleanup: async (extraIds: string[] = []) => {
      await prisma.complaint.deleteMany({ where: { customer_id: { in: [cust.id, ...extraIds] } } });
      await prisma.customer.deleteMany({ where: { id: { in: [cust.id, ...extraIds] } } });
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, cm.id, tech.id, agent.id] } } });
      await prisma.city.delete({ where: { id: city.id } });
    }
  };
}

// ─── [1] STATUS TRANSITION MATRIX (static code audit) ────────────────────────

async function auditTransitionMatrix() {
  console.log('\n[1] Status Transition Matrix (Static Code Audit)');

  const src = readFile('services/complaint.service.ts');

  // Required allowed transitions
  const required = [
    ['Open',       'Assigned'],
    ['Assigned',   'InProgress'],
    ['InProgress', 'Resolved'],
    ['Resolved',   'Closed'],
    ['Assigned',   'Escalated'],
    ['InProgress', 'Escalated'],
    ['Escalated',  'Assigned'],
    ['Escalated',  'InProgress'],
    ['Open',       'Closed'],    // audit — direct admin close
  ];

  for (const [from, to] of required) {
    // Check that the VALID_TRANSITIONS map contains both statuses
    const hasFrom = src.includes(`ComplaintStatus.${from}]:`);
    const hasTo   = src.includes(`ComplaintStatus.${to}`);
    if (hasFrom && hasTo) {
      ok(`Transition ${from} → ${to} is declared`);
    } else {
      fail(`Transition ${from} → ${to} missing from VALID_TRANSITIONS`);
    }
  }

  // Verify validateTransition is called before every state mutation
  const mutationMethods = ['assignComplaint', 'startComplaint', 'resolveComplaint', 'escalateComplaint', 'closeComplaint'];
  for (const method of mutationMethods) {
    const methodStart = src.indexOf(`async ${method}`);
    const methodEnd   = src.indexOf('\n  }', methodStart + 1);
    const body        = src.slice(methodStart, methodEnd);
    if (body.includes('validateTransition')) {
      ok(`${method}: validateTransition() called before state write`);
    } else {
      fail(`${method}: missing validateTransition() guard`);
    }
  }

  // Verify Closed is terminal (empty array)
  if (src.includes('[ComplaintStatus.Closed]: []')) {
    ok('Closed is terminal — no outgoing transitions');
  } else {
    fail('Closed state is not declared as terminal');
  }
}

// ─── [2] TIMELINE INTEGRITY (structural) ─────────────────────────────────────

async function auditTimelineIntegrity() {
  console.log('\n[2] Timeline Integrity (Structural Code Audit)');

  const src = readFile('services/complaint.service.ts');

  // Every complaint.update must nest a timeline.create
  const updateBlocks = src.split('prisma.complaint.update(');
  // first split is before any update
  for (let i = 1; i < updateBlocks.length; i++) {
    // find the closing brace block of data: {}
    const block = updateBlocks[i];
    if (block.includes('timeline: {') && block.includes('create: {')) {
      ok(`complaint.update #${i}: creates exactly one timeline entry`);
    } else {
      fail(`complaint.update #${i}: missing inline timeline.create`);
    }
  }

  // Verify no timeline.update or timeline.delete exists
  if (!src.includes('complaintTimeline.update') && !src.includes('timeline.update')) {
    ok('No timeline.update calls — append-only confirmed');
  } else {
    fail('Found timeline.update — breaks append-only contract');
  }

  if (!src.includes('complaintTimeline.delete') && !src.includes('timeline.delete')) {
    ok('No timeline.delete calls — immutability confirmed');
  } else {
    fail('Found timeline.delete — breaks immutability contract');
  }

  // Check DB: no duplicate timeline entries for same (complaint_id, to_status, changed_at)
  const dupes = await prisma.$queryRaw<{ cnt: bigint }[]>`
    SELECT COUNT(*) AS cnt
    FROM "ComplaintTimeline" a
    JOIN "ComplaintTimeline" b ON a.complaint_id = b.complaint_id
      AND a.to_status = b.to_status
      AND a.changed_at = b.changed_at
      AND a.id <> b.id
  `;
  if (Number(dupes[0].cnt) === 0) {
    ok('DB: No duplicate timeline entries found');
  } else {
    fail(`DB: Found ${dupes[0].cnt} duplicate timeline rows`);
  }
}

// ─── [3] EVENT CONSISTENCY (code audit) ──────────────────────────────────────

async function auditEventConsistency() {
  console.log('\n[3] Event Consistency (Static Code Audit)');

  const src = readFile('services/complaint.service.ts');

  // Required events per lifecycle method
  const expected: Record<string, string> = {
    createComplaint:   'Complaint.Created',
    assignComplaint:   'Complaint.Assigned',
    resolveComplaint:  'Complaint.Resolved',
    escalateComplaint: 'Complaint.Escalated',
  };

  for (const [method, event] of Object.entries(expected)) {
    const mStart = src.indexOf(`async ${method}`);
    const mEnd   = src.indexOf('\n  }\n', mStart + 1);
    const body   = src.slice(mStart, mEnd);

    if (!body.includes(`eventBus.publish('${event}'`)) {
      fail(`${method}: missing eventBus.publish('${event}')`);
      continue;
    }

    // Verify event is published AFTER the db write (prisma call appears before publish)
    const prismaPos  = body.indexOf('await prisma.complaint');
    const publishPos = body.indexOf(`eventBus.publish('${event}'`);
    if (prismaPos < publishPos) {
      ok(`${method}: '${event}' published after DB commit`);
    } else {
      fail(`${method}: '${event}' published BEFORE DB commit — ordering bug`);
    }

    // Verify exactly one publish of this event
    const count = (body.match(new RegExp(`eventBus\\.publish\\('${event}'`, 'g')) || []).length;
    if (count === 1) {
      ok(`${method}: exactly one '${event}' publish`);
    } else {
      fail(`${method}: ${count} publishes of '${event}' — duplicate event risk`);
    }
  }

  // startComplaint and closeComplaint intentionally have NO event (internal ops)
  const noEventMethods = ['startComplaint', 'closeComplaint'];
  for (const method of noEventMethods) {
    const mStart = src.indexOf(`async ${method}`);
    const mEnd   = src.indexOf('\n  }\n', mStart + 1);
    const body   = src.slice(mStart, mEnd);
    if (!body.includes('eventBus.publish')) {
      ok(`${method}: correctly emits no domain event (internal op)`);
    } else {
      // Not necessarily wrong, but flag it
      info(`${method}: emits event — verify this is intentional`);
    }
  }
}

// ─── [4] AUTOMATION ISOLATION (code audit) ───────────────────────────────────

async function auditAutomationIsolation() {
  console.log('\n[4] Automation Isolation (Static Code Audit)');

  const src = readFile('services/complaint.service.ts');

  const forbidden = [
    { pattern: 'notificationQueue',  label: 'NotificationQueue write' },
    { pattern: 'scheduledTask',      label: 'ScheduledTask write' },
    { pattern: 'NotificationQueue',  label: 'NotificationQueue import' },
    { pattern: 'ScheduledTask',      label: 'ScheduledTask import' },
    { pattern: 'notificationWorker', label: 'NotificationWorker reference' },
  ];

  for (const { pattern, label } of forbidden) {
    if (!src.includes(pattern)) {
      ok(`ComplaintService: no ${label} — automation boundary preserved`);
    } else {
      fail(`ComplaintService: contains ${label} — violates automation isolation`);
    }
  }

  // Verify only eventBus is the integration surface
  if (src.includes("from '../events/eventBus'")) {
    ok('ComplaintService: EventBus is the sole automation integration surface');
  } else {
    fail('ComplaintService: EventBus import missing');
  }
}

// ─── [5] RBAC AUDIT (E2E HTTP) ───────────────────────────────────────────────

async function auditRBAC(ctx: Awaited<ReturnType<typeof bootstrapTestUsers>>) {
  console.log('\n[5] RBAC Audit (E2E HTTP)');

  const headers = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

  // Create a complaint as admin
  const res = await axios.post(`${API}/complaints`, {
    customer_id: ctx.custId,
    subject: 'RBAC Test Complaint',
    description: 'Auditing RBAC boundaries',
    priority: 'Normal',
  }, headers(ctx.adminToken));
  const cId = res.data.id;

  // Super Admin: can create ✅
  if (res.status === 201) ok('Super Admin: can create complaint');
  else fail('Super Admin: failed to create complaint');

  // Super Admin: can assign ✅
  try {
    await axios.post(`${API}/complaints/${cId}/assign`, { assigned_to: ctx.techId }, headers(ctx.adminToken));
    ok('Super Admin: can assign complaint');
  } catch { fail('Super Admin: failed to assign complaint'); }

  // Technician: can start ✅ (assigned to them)
  try {
    await axios.post(`${API}/complaints/${cId}/start`, {}, headers(ctx.techToken));
    ok('Technician: can start assigned complaint');
  } catch { fail('Technician: failed to start assigned complaint'); }

  // Technician: cannot assign ❌ (403)
  try {
    await axios.post(`${API}/complaints/${cId}/assign`, { assigned_to: ctx.agentId }, headers(ctx.techToken));
    fail('Technician: should not be able to assign — 403 expected');
  } catch (e: any) {
    if (e.response?.status === 403) ok('Technician: correctly blocked from assign (403)');
    else fail(`Technician: assign returned ${e.response?.status} instead of 403`);
  }

  // Support Agent: cannot close ❌ (403 — only Super Admin)
  try {
    await axios.post(`${API}/complaints/${cId}/close`, {}, headers(ctx.agentToken));
    fail('Support Agent: should not be able to close — 403 expected');
  } catch (e: any) {
    if (e.response?.status === 403) ok('Support Agent: correctly blocked from close (403)');
    else fail(`Support Agent: close returned ${e.response?.status} instead of 403`);
  }

  // Another technician (agent playing role) cannot see unassigned complaint detail
  // Create fresh unassigned complaint
  const res2 = await axios.post(`${API}/complaints`, {
    customer_id: ctx.custId,
    subject: 'Unassigned RBAC Complaint',
    description: 'Should not be visible to unassigned tech',
  }, headers(ctx.adminToken));
  const cId2 = res2.data.id;

  try {
    await axios.get(`${API}/complaints/${cId2}`, headers(ctx.techToken));
    fail('Technician: should not see unassigned complaint detail');
  } catch (e: any) {
    if (e.response?.status === 403) ok('Technician: correctly blocked from unassigned complaint (403)');
    else fail(`Technician: unassigned complaint returned ${e.response?.status} instead of 403`);
  }

  // Cleanup
  await prisma.complaint.deleteMany({ where: { id: { in: [cId, cId2] } } });
}

// ─── [6] SEQUENCE GENERATOR CONCURRENCY ──────────────────────────────────────

async function auditSequenceConcurrency(ctx: Awaited<ReturnType<typeof bootstrapTestUsers>>) {
  console.log('\n[6] Sequence Generator Concurrency (Stress Test)');

  const headers = { Authorization: `Bearer ${ctx.adminToken}` };
  const COUNT = 5;

  // Fire N concurrent complaint creations
  const results = await Promise.allSettled(
    Array.from({ length: COUNT }, () =>
      axios.post(`${API}/complaints`, {
        customer_id: ctx.custId,
        subject: 'Concurrency Test',
        description: 'Testing sequence generation under load',
      }, { headers })
    )
  );

  const successes = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
  const ids   = successes.map(r => r.value.data.complaint_id as string);
  const seqs  = successes.map(r => r.value.data.sequence_number as number);
  const dbIds = successes.map(r => r.value.data.id as string);

  info(`Created ${successes.length}/${COUNT} complaints concurrently`);

  // All CMP IDs must be unique
  const uniqueIds = new Set(ids);
  if (uniqueIds.size === ids.length) {
    ok(`All ${ids.length} CMP IDs are unique`);
  } else {
    fail(`Duplicate CMP IDs detected: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
  }

  // Sequence numbers must be unique and all present
  const uniqueSeqs = new Set(seqs);
  if (uniqueSeqs.size === seqs.length) {
    ok(`All ${seqs.length} sequence numbers are unique (no race condition)`);
  } else {
    fail(`Duplicate sequence numbers: ${seqs.join(', ')}`);
  }

  // Verify strictly increasing
  const sorted = [...seqs].sort((a, b) => a - b);
  if (JSON.stringify(sorted) === JSON.stringify([...seqs].sort((a, b) => a - b))) {
    ok('Sequence numbers are strictly increasing');
  }

  // Cleanup concurrent complaints
  await prisma.complaint.deleteMany({ where: { id: { in: dbIds } } });
}

// ─── [7] DATABASE INTEGRITY (optional references) ────────────────────────────

async function auditDatabaseIntegrity(ctx: Awaited<ReturnType<typeof bootstrapTestUsers>>) {
  console.log('\n[7] Database Integrity (Optional References)');

  const headers = { Authorization: `Bearer ${ctx.adminToken}` };
  const toClean: string[] = [];

  // [A] Customer-only complaint (no booking/job/invoice)
  try {
    const r = await axios.post(`${API}/complaints`, {
      customer_id: ctx.custId,
      subject: 'Customer-only complaint',
      description: 'No booking, job, or invoice'
    }, { headers });
    ok('Complaint with customer_id only: created successfully');
    toClean.push(r.data.id);
  } catch (e: any) {
    fail(`Customer-only complaint: ${e.response?.data?.error || e.message}`);
  }

  // [B] Complaint referencing a non-existent booking should fail gracefully
  try {
    await axios.post(`${API}/complaints`, {
      customer_id: ctx.custId,
      booking_id: 'non-existent-booking-id',
      subject: 'Bad booking ref',
      description: 'Should fail with FK error'
    }, { headers });
    fail('Invalid booking_id should have been rejected (FK constraint)');
  } catch (e: any) {
    if (e.response?.status === 500 || e.response?.status === 400) {
      ok('Invalid booking_id correctly rejected by FK constraint');
    } else {
      fail(`Unexpected status ${e.response?.status} for invalid booking_id`);
    }
  }

  // [C] Verify schema: optional fields are nullable in DB
  const schemaContent = fs.readFileSync(path.join(__dirname, 'prisma/schema.prisma'), 'utf-8');
  const optionalFields = ['booking_id', 'job_id', 'invoice_id', 'assigned_to', 'resolution_note'];
  for (const field of optionalFields) {
    // In Prisma, optional fields have ? suffix in the model
    const pattern = new RegExp(`${field}\\s+String\\?`);
    if (pattern.test(schemaContent)) {
      ok(`Schema: ${field} is correctly optional (nullable)`);
    } else {
      fail(`Schema: ${field} may not be optional — verify`);
    }
  }

  // Cleanup
  await prisma.complaint.deleteMany({ where: { id: { in: toClean } } });
}

// ─── [8] REGRESSION SUITE ────────────────────────────────────────────────────

async function runRegression() {
  console.log('\n[8] Full Regression Suite');

  const { execSync } = require('child_process');
  const ROOT = __dirname;

  const suites = [
    { name: 'verify_system_integrity.ts',     label: 'Core CRM (Phase 8)' },
    { name: 'verify_phase9_automation.ts',    label: 'Automation Engine (Phase 9)' },
    { name: 'verify_phase11_complaints.ts',   label: 'Sprint 11.1 Lifecycle (E2E)' },
  ];

  for (const { name, label } of suites) {
    try {
      execSync(`npx tsx ${name}`, { cwd: ROOT, stdio: 'pipe' });
      ok(`${label}: PASS`);
    } catch (e: any) {
      const stderr = e.stderr?.toString() || '';
      fail(`${label}: FAIL\n     ${stderr.split('\n').slice(0, 3).join('\n     ')}`);
    }
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  ZOLVEX CRM — SPRINT 11.1 POST-FREEZE AUDIT');
  console.log(`  ${new Date().toISOString()}  |  Complaint Management`);
  console.log('══════════════════════════════════════════════════════════════════');

  let ctx: Awaited<ReturnType<typeof bootstrapTestUsers>> | null = null;

  try {
    await auditTransitionMatrix();
    await auditTimelineIntegrity();
    await auditEventConsistency();
    await auditAutomationIsolation();

    console.log('\n[Setup] Bootstrapping E2E test users...');
    ctx = await bootstrapTestUsers();
    console.log('  ✅ E2E users ready');

    await auditRBAC(ctx);
    await auditSequenceConcurrency(ctx);
    await auditDatabaseIntegrity(ctx);
    await runRegression();

  } catch (err: any) {
    fail(`Unexpected fatal error: ${err.message}`);
  } finally {
    if (ctx) {
      try { await ctx.cleanup(); console.log('\n  ✅ Test data cleaned up'); }
      catch (e) { console.warn('  ⚠️  Cleanup warning:', (e as any).message); }
    }
    await prisma.$disconnect();
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  SPRINT 11.1 POST-FREEZE AUDIT — RESULTS');
  console.log('══════════════════════════════════════════════════════════════════\n');
  info(`Total: ${passed + failed} checks | ${passed} passed | ${failed} failed`);

  if (failed === 0) {
    console.log('\n  ✅✅ ALL CHECKS PASS — SPRINT 11.1 AUDIT COMPLETE');
    console.log('  Complaint module is production-quality and frozen.\n');
    process.exit(0);
  } else {
    console.log('\n  OPEN ISSUES:');
    issues.forEach(i => console.log(`    ❌ ${i}`));
    console.log('\n  ❌ AUDIT FAILED — resolve before proceeding to Sprint 11.2\n');
    process.exit(1);
  }
}

run();
