import os from 'os';
import axios from 'axios';
import { execSync } from 'child_process';
import { mapsUtility } from './src/utils/maps.utility';

let passed = 0; let failed = 0;
const issues: string[] = [];
const ok   = (msg: string) => { console.log(`  ✅ ${msg}`); passed++; };
const fail = (msg: string) => { console.error(`  ❌ ${msg}`); failed++; issues.push(msg); };
const info = (msg: string) => console.log(`     ${msg}`);
const skip = (msg: string) => console.log(`  ⏭️  SKIP: ${msg}`);

const HAS_MAPS = !!process.env.GOOGLE_MAPS_API_KEY;

// Since this runs via tsx and not jest, we will just patch axios directly.

async function run() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ZOLVEX CRM — PHASE 10 SPRINT 10.3 VERIFICATION (Maps)');
  console.log(`  ${new Date().toISOString()}  |  Host: ${os.hostname()}`);
  console.log(`  MAPS credentials: ${HAS_MAPS ? '✅ Present' : '⏭️  Not configured'}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // Inject fake API key for test cases so it doesn't short-circuit with 'UNAVAILABLE'
  const ORIGINAL_KEY = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'FAKE_KEY_FOR_TESTS';
  const testUtility = new (mapsUtility.constructor as any)();

  // ── 1. MAPS UTILITY — BASIC VALIDATION ────────────────────────────────────
  console.log('[1] MapsUtility — Request Validation\n');

  // Identical coordinates (no API call made)
  const identReq = await testUtility.calculateRoute({ lat: 12.9716, lng: 77.5946 }, { lat: 12.9716, lng: 77.5946 });
  identReq.status === 'OK' && identReq.distanceKm === 0 && identReq.durationMinutes === 0
    ? ok('Identical coordinates return 0 without API call')
    : fail(`Identical coords failed: ${identReq.status}`);

  // Invalid coordinates
  const invalidReq = await testUtility.calculateRoute({ lat: 999, lng: 77 }, { lat: 12, lng: 77 });
  invalidReq.status === 'INVALID_REQUEST'
    ? ok('Out-of-bounds coordinates correctly rejected as INVALID_REQUEST')
    : fail(`Invalid coords failed: ${invalidReq.status}`);

  // Missing API Key
  delete process.env.GOOGLE_MAPS_API_KEY;
  const missingKeyUtil = new (mapsUtility.constructor as any)();
  const missingReq = await missingKeyUtil.calculateRoute({ lat: 12.97, lng: 77.59 }, { lat: 12.29, lng: 76.63 });
  missingReq.status === 'UNAVAILABLE'
    ? ok('Missing API key degrades gracefully to UNAVAILABLE (no crash)')
    : fail(`Missing API key failed: ${missingReq.status}`);
  process.env.GOOGLE_MAPS_API_KEY = 'FAKE_KEY_FOR_TESTS';

  // ── 2. MAPS UTILITY — ERROR HANDLING (Simulated) ──────────────────────────
  console.log('\n[2] MapsUtility — Error Handling & Retries (Mocked)\n');

  const originalPost = axios.post;

  // 2a. Quota Exceeded (Transient -> Retry -> Fail)
  let postCount = 0;
  axios.post = async () => {
    postCount++;
    const err: any = new Error('Quota Exceeded');
    err.isAxiosError = true;
    err.response = { status: 429 };
    throw err;
  };
  
  const quotaReq = await testUtility.calculateRoute({ lat: 12.97, lng: 77.59 }, { lat: 12.29, lng: 76.63 });
  quotaReq.status === 'QUOTA_EXCEEDED' ? ok('QUOTA_EXCEEDED returned on 429') : fail(`Quota returned: ${quotaReq.status}`);
  postCount === 3 ? ok('Retried exactly twice on transient 429 failure') : fail(`Retried ${postCount - 1} times instead of 2`);

  // 2b. Invalid Key (Permanent -> No Retry)
  postCount = 0;
  axios.post = async () => {
    postCount++;
    const err: any = new Error('Invalid Key');
    err.isAxiosError = true;
    err.response = { status: 403 };
    throw err;
  };

  const keyReq = await testUtility.calculateRoute({ lat: 12.97, lng: 77.59 }, { lat: 12.29, lng: 76.63 });
  keyReq.status === 'FAILED' ? ok('FAILED returned on 403') : fail(`Key returned: ${keyReq.status}`);
  postCount === 1 ? ok('Did NOT retry on permanent 403 failure') : fail(`Retried ${postCount - 1} times on permanent failure`);

  // 2c. Timeout (Transient)
  postCount = 0;
  axios.post = async () => {
    postCount++;
    const err: any = new Error('Timeout');
    err.isAxiosError = true;
    err.code = 'ETIMEDOUT';
    throw err;
  };

  const timeoutReq = await testUtility.calculateRoute({ lat: 12.97, lng: 77.59 }, { lat: 12.29, lng: 76.63 });
  timeoutReq.status === 'TIMEOUT' ? ok('TIMEOUT returned on ETIMEDOUT') : fail(`Timeout returned: ${timeoutReq.status}`);
  postCount === 3 ? ok('Retried exactly twice on timeout') : fail(`Retried ${postCount - 1} times on timeout`);

  // Restore axios
  axios.post = originalPost;
  if (ORIGINAL_KEY) process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_KEY; else delete process.env.GOOGLE_MAPS_API_KEY;

  // ── 3. MAPS UTILITY — LIVE API (If configured) ──────────────────────────
  console.log('\n[3] MapsUtility — Live API Integration\n');

  if (!HAS_MAPS) {
    skip('GOOGLE_MAPS_API_KEY not configured — skipping live API tests');
    info('Set PROVIDER_MODE=maps and provide API key to enable');
  } else {
    // Bangalore to Mysore (roughly 145km)
    const liveReq = await mapsUtility.calculateRoute({ lat: 12.9716, lng: 77.5946 }, { lat: 12.2958, lng: 76.6394 });
    
    liveReq.status === 'OK' 
      ? ok('Live API returned OK') 
      : fail(`Live API failed: ${liveReq.status}`);
      
    liveReq.distanceKm !== null && liveReq.distanceKm > 100 && liveReq.distanceKm < 200
      ? ok(`Live API returned valid distance: ${liveReq.distanceKm} km`)
      : fail(`Live API returned invalid distance: ${liveReq.distanceKm}`);

    liveReq.durationMinutes !== null && liveReq.durationMinutes > 60
      ? ok(`Live API returned valid duration: ${liveReq.durationMinutes} mins`)
      : fail(`Live API returned invalid duration: ${liveReq.durationMinutes}`);

    // getETA helper
    const eta = await mapsUtility.getETA({ lat: 12.9716, lng: 77.5946 }, { lat: 12.2958, lng: 76.6394 });
    eta === liveReq.durationMinutes
      ? ok('getETA helper returns correct duration')
      : fail('getETA helper mismatch');
  }

  // ── 4. PROVIDER CONFIGURATION VALIDATION ─────────────────────────────────
  console.log('\n[4] Config Validation (env.ts maps mode)\n');

  try {
    const testEnv: NodeJS.ProcessEnv = { ...process.env, PROVIDER_MODE: 'maps' };
    delete testEnv.GOOGLE_MAPS_API_KEY;
    execSync('npx tsx src/config/env.ts', { 
      cwd: process.cwd(), 
      stdio: 'pipe', 
      env: testEnv
    });
    fail('Maps mode should reject missing GOOGLE_MAPS_API_KEY');
  } catch {
    ok('Maps mode: rejects startup if GOOGLE_MAPS_API_KEY is missing (fail-fast confirmed)');
  }

  // ── 5. REGRESSION ────────────────────────────────────────────────────────
  console.log('\n[5] Regression Audit\n');

  const scripts = [
    { name: 'verify_system_integrity.ts',  label: 'Core CRM (Phase 8)' },
    { name: 'verify_phase9_automation.ts', label: 'Automation Engine (Phase 9)' },
    { name: 'verify_phase10_providers.ts', label: 'Provider Layer (Phase 10)' },
    { name: 'verify_phase10_sandbox.ts',   label: 'Sandbox Verification (Sprint 10.2)' },
  ];

  for (const { name, label } of scripts) {
    try {
      execSync(`npx tsx ${name}`, { cwd: process.cwd(), stdio: 'inherit' });
      ok(`${label}: PASS`);
    } catch {
      fail(`${label}: REGRESSION DETECTED`);
    }
  }

  // ── FINAL SUMMARY ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  SPRINT 10.3 VERIFICATION — RESULTS');
  console.log('══════════════════════════════════════════════════════════════\n');
  info(`Total: ${passed + failed} checks | ${passed} passed | ${failed} failed`);

  if (!HAS_MAPS) {
    info('Live maps tests skipped (no API key).');
  }

  if (failed > 0) {
    console.log('\n  OPEN ISSUES:');
    for (const issue of issues) console.log(`    ❌ ${issue}`);
    console.log('\n  ❌ Sprint 10.3 NOT ready for freeze');
  } else {
    console.log('\n  ✅ Sprint 10.3 VERIFIED — Ready for freeze');
  }

  console.log('══════════════════════════════════════════════════════════════\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async e => {
  console.error('Fatal audit error:', e);
  process.exit(1);
});
