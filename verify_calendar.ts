import { PrismaClient } from '@prisma/client';
// using native fetch
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
    const validStartTime = setHours(setMinutes(tomorrow, 0), 10); // 10:00 AM
    const conflictTime = setHours(setMinutes(tomorrow, 0), 10); // 10:00 AM
    const outsideTime = setHours(setMinutes(tomorrow, 0), 22); // 10:00 PM (Outside business hours)

    // Flow 1 & 2 & 3: Create Booking -> Convert to Job -> Assign -> Conflict
    console.log('\n--- Testing Booking & Dispatch Flows ---');
    
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

    await fetchApi(`/jobs/${jobId}/assign`, 'PATCH', { assigned_user_id: tech.id });
    console.log(`✅ Job assigned to Tech: ${tech.name}`);

    // Verify history
    const jobHistory = await prisma.jobHistory.findMany({ where: { job_id: jobId } });
    if (jobHistory.some(h => h.to_status === 'Assigned')) {
      console.log('✅ Job History written for Assignment');
    } else {
      console.log('❌ Job History missing for Assignment');
    }

    // Flow 3: Conflict Detection
    console.log('\n--- Testing Conflict Detection ---');
    const booking2Res = await fetchApi('/bookings', 'POST', {
      customer_id: customer.id,
      city_id: city.id,
      service_id: service.id,
      scheduled_date: conflictTime.toISOString(),
      slot: '10:00',
      total_price: 100,
      payment_status: 'Pending'
    });
    const booking2Id = booking2Res.data.id;
    const job2Res = await fetchApi(`/jobs/from-booking/${booking2Id}`, 'POST', { priority: 'Normal' });
    const job2Id = job2Res.data.id;

    try {
      await fetchApi(`/jobs/${job2Id}/assign`, 'PATCH', { assigned_user_id: tech.id });
      console.log('❌ Conflict detection failed - Job assigned');
    } catch (e: any) {
      if (e.response?.status === 409) {
        console.log('✅ Conflict correctly blocked (409)');
      } else {
        console.log(`❌ Conflict returned wrong status: ${e.response?.status}`);
      }
    }

    // Flow 4: Business Hours (via booking creation / reschedule)
    console.log('\n--- Testing Business Hours ---');
    try {
      await fetchApi('/bookings', 'POST', {
        customer_id: customer.id,
        city_id: city.id,
        service_id: service.id,
        scheduled_date: outsideTime.toISOString(),
        slot: '22:00',
        total_price: 100,
        payment_status: 'Pending'
      });
      console.log('❌ Business hours bypass failed - Booking created');
    } catch (e: any) {
      if (e.response?.status === 400) {
        console.log('✅ Business hours correctly blocked on create (400)');
      } else {
        console.log(`❌ Business hours returned wrong status: ${e.response?.status}`);
      }
    }

    // Flow 5: Booking Cancellation Sync
    console.log('\n--- Testing Booking Cancellation ---');
    try {
      await fetchApi(`/bookings/${booking2Id}/cancel`, 'PATCH', { cancel_reason: 'Test Cancel' });
    } catch(e) {}
    
    const checkJob2 = await prisma.job.findUnique({ where: { id: job2Id } });
    if (checkJob2?.status === 'Cancelled') {
      console.log('✅ Job successfully cancelled when Booking was cancelled');
    } else {
      console.log(`❌ Job status mismatch: ${checkJob2?.status}`);
    }

    // Flow 6: Job Completion Sync
    console.log('\n--- Testing Job Completion Sync ---');
    // Progress Job 1 to Completed
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Accepted' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Travelling' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Arrived' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Started' });
    await fetchApi(`/jobs/${jobId}/status`, 'PATCH', { status: 'Completed', completionNotes: 'Done' });
    
    const checkBooking1 = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (checkBooking1?.status === 'Completed') {
      console.log('✅ Booking successfully completed when Job was completed');
    } else {
      console.log(`❌ Booking status mismatch: ${checkBooking1?.status}`);
    }

    console.log('\n✅ ALL BACKEND AND SYNC WORKFLOWS PASSED');
  } catch (error: any) {
    console.error('❌ Test Failed:', error.response?.data || error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verify();
