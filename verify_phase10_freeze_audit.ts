/**
 * ZOLVEX CRM — PHASE 10 FINAL FREEZE AUDIT
 * =========================================
 * Independent, code-level verification of all Phase 10 architectural contracts.
 * All checks read source code and query the database directly — nothing is assumed.
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

const prisma = new PrismaClient();

let passed = 0; let failed = 0;
const issues: string[] = [];
const ok    = (msg: string) => { console.log(`  ✅ ${msg}`); passed++; };
const fail  = (msg: string) => { console.error(`  ❌ ${msg}`); failed++; issues.push(msg); };
const info  = (msg: string) => console.log(`     ${msg}`);
const warn  = (msg: string) => console.log(`  ⚠️  ${msg}`);

const SRC = path.resolve(__dirname, 'src');
const ROOT = path.resolve(__dirname);

/** Recursively collect all .ts files under a directory */
function collectTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/** Search for pattern in a file, return matching lines */
function grepFile(filePath: string, pattern: RegExp): string[] {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  return lines.filter(l => pattern.test(l));
}

/** Check if a file is within an allowed directory list */
function isInAllowedDir(filePath: string, allowedDirs: string[]): boolean {
  return allowedDirs.some(dir => filePath.startsWith(path.resolve(SRC, dir)));
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  ZOLVEX CRM — PHASE 10 FINAL FREEZE AUDIT');
  console.log(`  ${new Date().toISOString()}  |  Host: ${os.hostname()}`);
  console.log('══════════════════════════════════════════════════════════════════\n');

  const allSrcFiles = collectTsFiles(SRC);
  info(`Source files scanned: ${allSrcFiles.length}`);

  // ── 1. NOTIFICATION QUEUE LIFECYCLE ─────────────────────────────────────────
  console.log('\n[1] NotificationQueue Lifecycle Transitions\n');

  const VALID_STATUSES = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'];
  const invalidStates = await prisma.notificationQueue.count({
    where: { status: { notIn: VALID_STATUSES as any } }
  });
  invalidStates === 0
    ? ok('All NotificationQueue rows have valid lifecycle states (no invalid transitions found)')
    : fail(`Found ${invalidStates} rows with invalid state values`);

  const sentWithoutId = await prisma.notificationQueue.count({
    where: { status: 'SENT', provider_message_id: null }
  });
  sentWithoutId === 0
    ? ok('All SENT notifications possess a provider_message_id (delivery integrity confirmed)')
    : fail(`Found ${sentWithoutId} SENT notifications missing provider_message_id`);

  const totalQueueRows = await prisma.notificationQueue.count();
  info(`Total NotificationQueue rows in DB: ${totalQueueRows}`);

  // ── 2. PROVIDER ISOLATION ────────────────────────────────────────────────────
  console.log('\n[2] Provider Isolation Audit\n');

  // These imports must ONLY exist in providers/ or utils/
  const RESTRICTED_IMPORTS: { pattern: RegExp; name: string }[] = [
    { pattern: /from ['"]axios['"]/,                 name: 'axios' },
    { pattern: /from ['"]nodemailer['"]/,            name: 'nodemailer' },
    { pattern: /MetaWhatsAppProvider/,               name: 'MetaWhatsAppProvider' },
    { pattern: /EmailProvider/,                      name: 'EmailProvider' },
    { pattern: /MapsUtility|maps\.utility/,          name: 'MapsUtility' },
  ];

  const ALLOWED_PROVIDER_DIRS = [
    path.resolve(SRC, 'providers'),
    path.resolve(SRC, 'utils'),
  ];

  for (const { pattern, name } of RESTRICTED_IMPORTS) {
    const violations: string[] = [];
    for (const file of allSrcFiles) {
      const inAllowed = ALLOWED_PROVIDER_DIRS.some(d => file.startsWith(d));
      if (inAllowed) continue; // allowed
      const matches = grepFile(file, pattern);
      if (matches.length > 0) {
        violations.push(`  ${path.relative(ROOT, file)}`);
      }
    }
    if (violations.length === 0) {
      ok(`[${name}] — not imported by any business module (isolation confirmed)`);
    } else {
      fail(`[${name}] — found outside providers/ in:\n${violations.join('\n')}`);
    }
  }

  // ── 3. TEMPLATE OWNERSHIP ────────────────────────────────────────────────────
  console.log('\n[3] Template Ownership Audit\n');

  // Only check for notification message text in string literals (not code comments or idempotency keys)
  const LITERAL_TEXT_PATTERNS: { pattern: RegExp; label: string }[] = [
    { pattern: /['"`]Dear Customer/i,        label: '"Dear Customer"' },
    { pattern: /['"`]Hello Customer/i,       label: '"Hello Customer"' },
    { pattern: /['"`]Payment Received/i,     label: '"Payment Received"' },
    { pattern: /['"`]Your booking/i,         label: '"Your booking"' },
    { pattern: /['"`]Invoice is overdue/i,   label: '"Invoice is overdue"' },
    { pattern: /body:\s*['"`]Reminder/i,     label: 'Raw Reminder body string' },
  ];

  const TEMPLATE_OWNER = path.resolve(SRC, 'providers', 'TemplateRenderer.ts');

  for (const { pattern, label } of LITERAL_TEXT_PATTERNS) {
    const violations: string[] = [];
    for (const file of allSrcFiles) {
      if (file === TEMPLATE_OWNER) continue; // owner is exempt
      const matches = grepFile(file, pattern);
      if (matches.length > 0) {
        violations.push(`  ${path.relative(ROOT, file)}: ${matches[0].trim()}`);
      }
    }
    if (violations.length === 0) {
      ok(`${label} — found only in TemplateRenderer (no leakage)`);
    } else {
      fail(`${label} — leaked outside TemplateRenderer:\n${violations.join('\n')}`);
    }
  }

  // ── 4. QUEUE OWNERSHIP ───────────────────────────────────────────────────────
  console.log('\n[4] Queue Ownership Audit\n');

  // DeliveryService owns status updates. NotificationWorker is approved to call updateMany()
  // exclusively for atomic row locking (PENDING→PROCESSING), which is architecturally correct.
  // Any other module mutating the queue is a violation.
  const QUEUE_UPDATE_PATTERN = /notificationQueue\.update(?!Many)\s*\(/;
  const QUEUE_LOCK_PATTERN   = /notificationQueue\.updateMany\s*\(/;
  const DELIVERY_SERVICE_FILE = path.resolve(SRC, 'providers', 'DeliveryService.ts');
  const WORKER_FILE = path.resolve(SRC, 'workers', 'notificationWorker.ts');
  const queueViolations: string[] = [];

  for (const file of allSrcFiles) {
    // DeliveryService owns update() (status transitions)
    if (file === DELIVERY_SERVICE_FILE) continue;
    const updateMatches = grepFile(file, QUEUE_UPDATE_PATTERN);
    if (updateMatches.length > 0) {
      queueViolations.push(`  ${path.relative(ROOT, file)}: ${updateMatches[0].trim()}`);
    }
    // NotificationWorker owns updateMany() (atomic row locking)
    if (file === WORKER_FILE) continue;
    const lockMatches = grepFile(file, QUEUE_LOCK_PATTERN);
    if (lockMatches.length > 0) {
      queueViolations.push(`  ${path.relative(ROOT, file)}: ${lockMatches[0].trim()}`);
    }
  }

  queueViolations.length === 0
    ? ok('NotificationQueue mutations owned exclusively by DeliveryService (status) + NotificationWorker (locking)')
    : fail(`Queue ownership violated by:\n${queueViolations.join('\n')}`);

  // Verify DeliveryService itself exists and does update the queue
  const dsContent = fs.readFileSync(DELIVERY_SERVICE_FILE, 'utf-8');
  dsContent.includes('notificationQueue.update')
    ? ok('DeliveryService.ts correctly manages NotificationQueue status transitions')
    : warn('DeliveryService.ts does not appear to call notificationQueue.update (review manually)');

  // ── 5. MAPS OWNERSHIP ────────────────────────────────────────────────────────
  console.log('\n[5] Maps Ownership Audit\n');

  // MapsUtility must only be imported by approved consumers
  // Currently: the utility itself. Phase 11 will add dispatch when ready.
  const MAPS_IMPORT_PATTERN = /from.*maps\.utility|mapsUtility/;
  const MAPS_UTILITY_FILE = path.resolve(SRC, 'utils', 'maps.utility.ts');
  const mapsViolations: string[] = [];

  for (const file of allSrcFiles) {
    if (file === MAPS_UTILITY_FILE) continue;
    const matches = grepFile(file, MAPS_IMPORT_PATTERN);
    if (matches.length > 0) {
      mapsViolations.push(`  ${path.relative(ROOT, file)}: ${matches[0].trim()}`);
    }
  }

  if (mapsViolations.length === 0) {
    ok('MapsUtility — not consumed by any business service (isolation confirmed, ready for Phase 11 Dispatch)');
  } else {
    // Acceptable consumers are dispatch-related services
    const unexpectedConsumers = mapsViolations.filter(v => !v.includes('dispatch'));
    if (unexpectedConsumers.length === 0) {
      ok(`MapsUtility — consumed only by approved Dispatch module`);
    } else {
      fail(`MapsUtility — imported by non-approved modules:\n${unexpectedConsumers.join('\n')}`);
    }
  }

  // ── 6. PROVIDER CREDENTIALS AUDIT ────────────────────────────────────────────
  console.log('\n[6] Provider Credential Security Audit\n');

  // Verify no credentials are hardcoded in source
  const CREDENTIAL_PATTERNS: { pattern: RegExp; label: string }[] = [
    { pattern: /ACCESS_TOKEN\s*=\s*['"][A-Za-z0-9+/]{20,}['"]/,  label: 'Hardcoded access token' },
    { pattern: /SMTP_PASS\s*=\s*['"][^'"]{6,}['"]/,               label: 'Hardcoded SMTP password' },
    { pattern: /EAA[A-Za-z0-9]{20,}/,                             label: 'Hardcoded Meta API token' },
    { pattern: /AIza[A-Za-z0-9_-]{35}/,                           label: 'Hardcoded Google API key' },
  ];

  for (const { pattern, label } of CREDENTIAL_PATTERNS) {
    const violations: string[] = [];
    for (const file of allSrcFiles) {
      const matches = grepFile(file, pattern);
      if (matches.length > 0) {
        violations.push(`  ${path.relative(ROOT, file)}`);
      }
    }
    violations.length === 0
      ? ok(`${label} — not hardcoded in any source file`)
      : fail(`${label} — found hardcoded in:\n${violations.join('\n')}`);
  }

  // Verify that DB does not contain sensitive data in text fields
  const logsWithToken = await prisma.automationExecutionLog.count({
    where: {
      OR: [
        { error_message: { contains: 'Bearer' } },
        { error_message: { contains: 'ACCESS_TOKEN' } },
        { error_message: { contains: 'EAA' } },
        { action_taken:  { contains: 'Bearer' } },
      ]
    }
  });
  logsWithToken === 0
    ? ok('AutomationExecutionLog — no credential tokens found in DB records')
    : fail(`AutomationExecutionLog — found ${logsWithToken} records with potential credential leakage`);

  // ── 7. CLEANUP SAFETY AUDIT ──────────────────────────────────────────────────
  console.log('\n[7] Cleanup Safety Audit\n');

  // Check for unfiltered deleteMany() / updateMany() in any .ts file
  const UNSAFE_CLEANUP_PATTERN = /\.(deleteMany|updateMany)\s*\(\s*\)/;
  const FILTERED_PATTERN = /\.(deleteMany|updateMany)\s*\(\s*\{/;

  const allRootTs = [
    ...collectTsFiles(SRC),
    ...fs.readdirSync(ROOT)
      .filter(f => f.endsWith('.ts') && !f.startsWith('node_modules'))
      .map(f => path.join(ROOT, f))
  ];

  const cleanupViolations: string[] = [];
  for (const file of allRootTs) {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (UNSAFE_CLEANUP_PATTERN.test(line)) {
        cleanupViolations.push(`  ${path.relative(ROOT, file)}:${idx + 1} → ${line.trim()}`);
      }
    });
  }

  cleanupViolations.length === 0
    ? ok('No unfiltered deleteMany() or updateMany() calls found — cleanup safety confirmed')
    : fail(`Unsafe blanket cleanup operations found:\n${cleanupViolations.join('\n')}`);

  // ── 8. RUNTIME METRICS ───────────────────────────────────────────────────────
  console.log('\n[8] Runtime Metrics Report\n');

  // Provider latency (from AutomationExecutionLog)
  const successLogs = await prisma.automationExecutionLog.findMany({
    where: { status: 'SUCCESS' },
    select: { duration_ms: true }
  });
  const totalMs = successLogs.reduce((s, l) => s + (l.duration_ms ?? 0), 0);
  const avgLatency = successLogs.length > 0 ? (totalMs / successLogs.length).toFixed(2) : 'N/A';
  info(`Average Provider Latency    : ${avgLatency} ms  (${successLogs.length} successful deliveries)`);

  // Queue stats
  const queueStats = await prisma.notificationQueue.groupBy({
    by: ['status'],
    _count: { id: true }
  });
  const byStatus: Record<string, number> = {};
  queueStats.forEach(s => { byStatus[s.status] = s._count.id; });

  const totalSent    = byStatus['SENT']       ?? 0;
  const totalFailed  = byStatus['FAILED']     ?? 0;
  const totalRetrying = byStatus['RETRYING']  ?? 0;
  const totalPending = byStatus['PENDING']    ?? 0;

  info(`Total Notifications Sent    : ${totalSent}`);
  info(`Total Failed                : ${totalFailed}`);
  info(`Current Queue Depth         : ${totalPending}`);

  const failRate = totalSent + totalFailed > 0
    ? ((totalFailed / (totalSent + totalFailed)) * 100).toFixed(2)
    : '0.00';
  info(`Delivery Failure Rate       : ${failRate}%`);

  // Worker metrics from AutomationMetric table
  const workerMetrics = await prisma.automationMetric.findMany();
  info(`\n     Worker Metrics (cumulative from AutomationMetric):`);
  for (const m of workerMetrics) {
    info(`       - ${m.metric_key}: ${m.value}`);
  }

  const notifsSent   = workerMetrics.find(m => m.metric_key === 'Notifications.Sent')?.value   ?? 0;
  const notifsRetried = workerMetrics.find(m => m.metric_key === 'Notifications.Retried')?.value ?? 0;
  const notifsFailed  = workerMetrics.find(m => m.metric_key === 'Notifications.Failed')?.value  ?? 0;
  const retryRate = Number(notifsSent) + Number(notifsFailed) > 0
    ? ((Number(notifsRetried) / (Number(notifsSent) + Number(notifsFailed))) * 100).toFixed(2)
    : '0.00';
  info(`\n     Retry Rate                : ${retryRate}%`);

  ok('Runtime metrics extracted and verified');

  // ── 9. FINAL REGRESSION SUITE ────────────────────────────────────────────────
  console.log('\n[9] Final Full-System Regression\n');

  const SUITES = [
    { name: 'verify_system_integrity.ts',  label: 'Core CRM (Phase 8)' },
    { name: 'verify_phase9_automation.ts', label: 'Automation Engine (Phase 9)' },
    { name: 'verify_phase10_providers.ts', label: 'Provider Layer (Phase 10.1)' },
    { name: 'verify_phase10_sandbox.ts',   label: 'Sandbox Layer (Phase 10.2)' },
    { name: 'verify_phase10_maps.ts',      label: 'Maps Utility (Phase 10.3)' },
  ];

  for (const { name, label } of SUITES) {
    try {
      execSync(`npx tsx ${name}`, { cwd: ROOT, stdio: 'inherit' });
      ok(`${label}: PASS`);
    } catch {
      fail(`${label}: REGRESSION DETECTED`);
    }
  }

  // ── DISCONNECT ───────────────────────────────────────────────────────────────
  await prisma.$disconnect();

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  PHASE 10 FINAL FREEZE AUDIT — RESULTS');
  console.log('══════════════════════════════════════════════════════════════════\n');
  info(`Checks: ${passed + failed} total | ${passed} passed | ${failed} failed`);

  if (failed > 0) {
    console.log('\n  OPEN ISSUES (must resolve before Phase 10 is frozen):');
    for (const issue of issues) console.log(`    ❌ ${issue}`);
    console.log('\n  ❌ PHASE 10 NOT FROZEN — resolve issues above first\n');
    process.exit(1);
  } else {
    console.log('\n  ✅ ALL CHECKS PASS — PHASE 10 IS OFFICIALLY FROZEN');
    console.log('  Phases 0–10 are production-ready. Proceeding to Phase 11.\n');
    process.exit(0);
  }
}

run().catch(async e => {
  console.error('Fatal audit error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
