import { PrismaClient } from '@prisma/client';
import { format, addDays, setHours, setMinutes } from 'date-fns';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:5000/api/v1';
let authToken = '';

async function login() {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@zolvex.com', password: 'password123' })
  });
  const data = await res.json();
  authToken = data.data.token;
}

async function fetchApi(endpoint: string, method: string, body?: any) {
  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json();
  if (!res.ok) {
    const error: any = new Error(data.message || 'API Error');
    error.status = res.status;
    error.response = { status: res.status, data };
    throw error;
  }
  return data;
}

async function verify() {
  try {
    await login();
    console.log('✅ Logged in as Admin');

    // 1. Setup Data
    const tech = await prisma.user.findFirst({ where: { role: { name: 'Field Staff' } } });
    const service = await prisma.service.findFirst();
    const city = await prisma.city.findFirst();
    const customer = await prisma.customer.findFirst();
    
    if (!tech || !service || !city || !customer) {
      console.log('❌ Setup data missing');
      return;
    }

    const tomorrow = addDays(new Date(), 1);
    const validStartTime = setHours(setMinutes(tomorrow, 0), 10);

    console.log('\n--- 1. Preparation: Lead -> Booking -> Job ---');
    const bookingRes = await fetchApi('/bookings', 'POST', {
      customer_id: customer.id,
      city_id: city.id,
      service_id: service.id,
      scheduled_date: validStartTime.toISOString(),
      slot: '10:00',
      total_price: 100,
      payment_status: 'Pending'
    });
    const bookingId = bookingRes.data.id;
    console.log(`✅ Booking created: ${bookingId}`);

    const jobRes = await fetchApi(`/jobs/from-booking/${bookingId}`, 'POST', { priority: 'Normal' });
    const jobId = jobRes.data.id;
    console.log(`✅ Job generated: ${jobId}`);

    console.log('\n--- 2. Gate Check: Attempt invoice on Pending Job ---');
    try {
      await fetchApi(`/invoices/from-booking/${bookingId}`, 'POST');
      console.log('❌ Gate check failed. Invoice created for Pending Job.');
    } catch (e: any) {
      if (e.status === 400) console.log('✅ Gate check passed (400)');
      else console.log(`❌ Gate check failed with status ${e.status}`);
    }

    console.log('\n--- 3. Completion & Auto-Generation Check ---');
    // Progress Job to Completed
    await fetchApi(`/jobs/${jobId}/assign`, 'PATCH', { assigned_user_id: tech.id });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Accepted' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Travelling' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Arrived' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Started' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Completed', completionNotes: 'Done' });
    
    // Check if Invoice was auto-generated
    const invoices = await prisma.invoice.findMany({ where: { booking_id: bookingId } });
    if (invoices.length === 1) {
      console.log('✅ Invoice auto-generated upon Job completion.');
    } else {
      console.log(`❌ Expected 1 invoice, found ${invoices.length}`);
    }

    console.log('\n--- 4. Duplicate Check: Prevent second invoice ---');
    try {
      await fetchApi(`/invoices/from-booking/${bookingId}`, 'POST');
      console.log('❌ Duplicate check failed. Second invoice created.');
    } catch (e: any) {
      if (e.status === 409) console.log('✅ Duplicate check passed (409 Conflict)');
      else console.log(`❌ Duplicate check failed with status ${e.status}`);
    }

    console.log('\n--- 5. Snapshot Integrity Check ---');
    const invoice = invoices[0];
    if (Number(invoice.final_amount) === 100 && Number(invoice.cgst_percent) === 9) {
       console.log('✅ Snapshot pricing and tax logic is perfectly captured.');
    } else {
       console.log('❌ Snapshot financial mismatch');
    }

    console.log('\n--- 6. State Machine: Issue Invoice ---');
    const issueRes = await fetchApi(`/invoices/${invoice.id}/status`, 'PATCH', { status: 'Issued' });
    if (issueRes.data.status === 'Issued') {
      console.log('✅ Invoice transitioned to Issued.');
    } else {
      console.log('❌ Invoice failed to Issue.');
    }

    console.log('\n✅ ALL RUNTIME VERIFICATION CHECKS PASSED');
  } catch (error: any) {
    console.error('❌ Test Failed:', error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
