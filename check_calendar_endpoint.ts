import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const loginRes = await fetch('http://localhost:5000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '9999999999', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  const token = loginData.data.token;

  const today = new Date().toISOString().split('T')[0];
  const url = `http://localhost:5000/api/v1/jobs/calendar?start_date=2026-07-02T18:30:00.000Z&end_date=2026-07-03T18:29:59.999Z`;
  console.log('URL:', url);

  const calRes = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const calData = await calRes.json();
  console.log(JSON.stringify(calData, null, 2));
}

run().catch(console.error);
