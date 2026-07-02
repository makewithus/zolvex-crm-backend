import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:5000/api/v1';
let authToken = '';

async function fetchApi(path: string, options: any = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
    ...(options.headers || {})
  };
  
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers
  });
  
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  
  return { status: res.status, data };
}

let report = '# API Verification Sprint Report\n\n';

async function logTest(name: string, endpoint: string, method: string, payload: any, expectedStatus: number, dbBefore: any, execute: () => Promise<any>, getDbAfter: () => Promise<any>) {
  report += `### ${name}\n`;
  report += `**Endpoint:** \`${method} ${endpoint}\`\n\n`;
  report += `**Request Payload:**\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\n`;
  report += `**Database State (Before):**\n\`\`\`json\n${JSON.stringify(dbBefore, null, 2)}\n\`\`\`\n\n`;
  
  const res = await execute();
  
  report += `**Response (Status: ${res.status}):**\n\`\`\`json\n${JSON.stringify(res.data, null, 2)}\n\`\`\`\n\n`;
  
  const dbAfter = await getDbAfter();
  report += `**Database State (After):**\n\`\`\`json\n${JSON.stringify(dbAfter, null, 2)}\n\`\`\`\n\n`;
  
  if (res.status === expectedStatus) {
    report += `✅ Test Passed (Expected ${expectedStatus}, got ${res.status})\n\n---\n\n`;
  } else {
    report += `❌ Test Failed (Expected ${expectedStatus}, got ${res.status})\n\n---\n\n`;
  }
}

async function run() {
  console.log("Starting tests...");
  
  // 1. Auth
  const loginRes = await fetchApi('/auth/login', { method: 'POST', body: JSON.stringify({ phone: '9999999999', password: 'admin123' }) });
  authToken = loginRes.data.data.token;

  // Get Super Admin Role and a City
  const role = await prisma.role.findFirst({ where: { name: 'City Manager' } });
  
  // Setup: Create dummy entities
  const city = await prisma.city.create({ data: { name: 'TestCity_API' } });
  const user = await prisma.user.create({ data: { name: 'TestUser_API', phone: '1111111111', role_id: role!.id, password_hash: 'dummy' } });
  const service = await prisma.service.create({ data: { name: 'TestService_API', base_price: 100 } });
  const rule = await prisma.pricingRule.create({ data: { service_id: service.id, base_price: 120 } });
  
  const fakeId = '00000000-0000-0000-0000-000000000000';

  // --- EDIT USER ---
  await logTest(
    "1. Edit User - Success (Partial Update)",
    `/users/${user.id}`, "PATCH", { name: "UpdatedName" }, 200,
    await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true } }),
    () => fetchApi(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ name: "UpdatedName" }) }),
    async () => await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true } })
  );

  await logTest(
    "1. Edit User - Validation (Invalid Phone length)",
    `/users/${user.id}`, "PATCH", { phone: "123" }, 400,
    await prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } }),
    () => fetchApi(`/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ phone: "123" }) }),
    async () => await prisma.user.findUnique({ where: { id: user.id }, select: { phone: true } })
  );

  await logTest(
    "1. Edit User - Not Found",
    `/users/${fakeId}`, "PATCH", { name: "Ghost" }, 404,
    null,
    () => fetchApi(`/users/${fakeId}`, { method: 'PATCH', body: JSON.stringify({ name: "Ghost" }) }),
    async () => null
  );

  // --- RESET PASSWORD ---
  await logTest(
    "2. Reset Password - Success",
    `/users/${user.id}/reset-password`, "PATCH", { new_password: "newSecurePassword123" }, 200,
    await prisma.user.findUnique({ where: { id: user.id }, select: { password_hash: true } }),
    () => fetchApi(`/users/${user.id}/reset-password`, { method: 'PATCH', body: JSON.stringify({ new_password: "newSecurePassword123" }) }),
    async () => await prisma.user.findUnique({ where: { id: user.id }, select: { password_hash: true } })
  );

  // --- EDIT CITY ---
  await logTest(
    "3. Edit City - Success",
    `/cities/${city.id}`, "PATCH", { is_active: false }, 200,
    await prisma.city.findUnique({ where: { id: city.id }, select: { is_active: true } }),
    () => fetchApi(`/cities/${city.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: false }) }),
    async () => await prisma.city.findUnique({ where: { id: city.id }, select: { is_active: true } })
  );

  // --- EDIT SERVICE ---
  await logTest(
    "4. Edit Service - Success",
    `/services/${service.id}`, "PATCH", { base_price: 150 }, 200,
    await prisma.service.findUnique({ where: { id: service.id }, select: { base_price: true } }),
    () => fetchApi(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify({ base_price: 150 }) }),
    async () => await prisma.service.findUnique({ where: { id: service.id }, select: { base_price: true } })
  );

  // --- EDIT PRICING RULE ---
  await logTest(
    "5. Edit Pricing Rule - Success",
    `/pricing-rules/${rule.id}`, "PATCH", { base_price: 200, bhk_type: "3BHK" }, 200,
    await prisma.pricingRule.findUnique({ where: { id: rule.id }, select: { base_price: true, bhk_type: true } }),
    () => fetchApi(`/pricing-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ base_price: 200, bhk_type: "3BHK" }) }),
    async () => await prisma.pricingRule.findUnique({ where: { id: rule.id }, select: { base_price: true, bhk_type: true } })
  );

  // --- DELETE PRICING RULE ---
  await logTest(
    "6. Delete Pricing Rule - Success",
    `/pricing-rules/${rule.id}`, "DELETE", {}, 204,
    await prisma.pricingRule.findUnique({ where: { id: rule.id } }),
    () => fetchApi(`/pricing-rules/${rule.id}`, { method: 'DELETE' }),
    async () => await prisma.pricingRule.findUnique({ where: { id: rule.id } })
  );

  await logTest(
    "6. Delete Pricing Rule - Second Delete Returns 404",
    `/pricing-rules/${rule.id}`, "DELETE", {}, 404,
    null,
    () => fetchApi(`/pricing-rules/${rule.id}`, { method: 'DELETE' }),
    async () => null
  );

  // Teardown
  await prisma.user.delete({ where: { id: user.id } }).catch(()=>{});
  await prisma.city.delete({ where: { id: city.id } }).catch(()=>{});
  await prisma.service.delete({ where: { id: service.id } }).catch(()=>{});

  fs.writeFileSync('api_report.md', report);
  console.log("Done!");
}

run().catch(console.error);
