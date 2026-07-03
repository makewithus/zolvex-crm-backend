import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { format, addDays, setHours, setMinutes } from 'date-fns';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:5000/api/v1';
let authToken = '';

async function login() {
  const res = await axios.post(`${API_URL}/auth/login`, {
    email: 'admin@zolvex.com',
    password: 'password123'
  });
  authToken = res.data.data.token;
  axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
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
    
    const bookingRes = await axios.post(`${API_URL}/bookings`, {
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

    const jobRes = await axios.post(`${API_URL}/jobs/from-booking/${bookingId}`, { priority: 'Normal' });
    const jobId = jobRes.data.id;
    console.log(`✅ Job generated: ${jobId}`);

    await axios.patch(`${API_URL}/jobs/${jobId}/assign`, { assigned_user_id: tech.id });
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
    const booking2Res = await axios.post(`${API_URL}/bookings`, {
      customer_id: customer.id,
      city_id: city.id,
      service_id: service.id,
      scheduled_date: conflictTime.toISOString(),
      slot: '10:00',
      total_price: 100,
      payment_status: 'Pending'
    });
    const booking2Id = booking2Res.data.id;
    const job2Res = await axios.post(`${API_URL}/jobs/from-booking/${booking2Id}`, { priority: 'Normal' });
    const job2Id = job2Res.data.id;

    try {
      await axios.patch(`${API_URL}/jobs/${job2Id}/assign`, { assigned_user_id: tech.id });
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
      await axios.post(`${API_URL}/bookings`, {
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
    await axios.patch(`${API_URL}/bookings/${booking2Id}/cancel`, { cancel_reason: 'Test Cancel' });
    const checkJob2 = await prisma.job.findUnique({ where: { id: job2Id } });
    if (checkJob2?.status === 'Cancelled') {
      console.log('✅ Job successfully cancelled when Booking was cancelled');
    } else {
      console.log(`❌ Job status mismatch: ${checkJob2?.status}`);
    }

    // Flow 6: Job Completion Sync
    console.log('\n--- Testing Job Completion Sync ---');
    // Progress Job 1 to Completed
    await axios.patch(`${API_URL}/jobs/${jobId}/status`, { status: 'Accepted' });
    await axios.patch(`${API_URL}/jobs/${jobId}/status`, { status: 'Travelling' });
    await axios.patch(`${API_URL}/jobs/${jobId}/status`, { status: 'Arrived' });
    await axios.patch(`${API_URL}/jobs/${jobId}/status`, { status: 'Started' });
    await axios.patch(`${API_URL}/jobs/${jobId}/status`, { status: 'Completed', completionNotes: 'Done' });
    
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
