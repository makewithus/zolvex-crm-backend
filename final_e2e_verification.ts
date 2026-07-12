import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:5000/api/v1';

async function runRegression() {
  console.log('--- STARTING E2E REGRESSION SUITE ---\n');
  try {
  
  // 1. Login as Super Admin
  const loginRes = await axios.post(`${API_URL}/auth/login`, { phone: '9999999999', password: 'admin123' });
  const adminToken = loginRes.data.data.token;
  console.log('✓ Login successful. Token received.');

  // Check DB for existing test customer or create one
  const uniquePhone = '99' + Math.floor(10000000 + Math.random() * 90000000).toString();
  const customer = await prisma.customer.create({
    data: { name: 'E2E Test Customer', phone: uniquePhone }
  });

  let service = await prisma.service.findFirst();
  if (!service) {
    service = await prisma.service.create({
      data: { name: 'E2E AC Repair', description: 'Test', base_price: 500, is_active: true }
    });
  }

  let city = await prisma.city.findFirst();
  if (!city) {
    city = await prisma.city.create({
      data: { name: 'E2E City', is_active: true }
    });
  }

  // Find a technician
  const techRole = await prisma.role.findUnique({ where: { name: 'Technician' } });
  const tech = await prisma.user.findFirst({ where: { role_id: techRole?.id } });
  
  if (!tech) {
     console.error('No technician found to assign jobs');
     return;
  }

  let pricingRule = await prisma.pricingRule.findFirst({ where: { city_id: city.id, service_id: service.id } });
  if (!pricingRule) {
    pricingRule = await prisma.pricingRule.create({
      data: {
        city_id: city.id,
        service_id: service.id,
        base_price: 500,
        cgst_percent: 9,
        sgst_percent: 9,
        igst_percent: 0
      }
    });
  }

  // 2. Create Booking
  console.log('\n--- CREATING BOOKING ---');
    const randomFutureDay = Math.floor(Math.random() * 100) + 1; // 1 to 100 days in future
    const scheduleDate = new Date();
    scheduleDate.setUTCDate(scheduleDate.getUTCDate() + randomFutureDay);
    scheduleDate.setUTCHours(12, 0, 0, 0);

    const bookingRes = await axios.post(`${API_URL}/bookings`, {
      customer_id: customer.id,
      customer_phone: customer.phone,
      customer_name: customer.name,
      service_id: service.id,
      city_id: city.id,
      city_name: city.name,
      scheduled_date: scheduleDate.toISOString(),
      scheduled_start: scheduleDate.toISOString(),
    address_line_1: '123 E2E Street',
    state: 'Maharashtra',
    postal_code: '400001'
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  
  const bookingId = bookingRes.data.data.id;
  console.log(`✓ Booking created: ${bookingId}`);
  console.log(`Response Snippet:`, JSON.stringify(bookingRes.data.data).slice(0, 100) + '...');

  // 3. Create Job from Booking
  console.log('\n--- GENERATING JOB ---');
  const jobRes = await axios.post(`${API_URL}/jobs/from-booking/${bookingId}`, {
    priority: 'Normal'
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  
  const jobId = jobRes.data.data.id;
  if (!jobId) {
    console.error('❌ Job creation failed');
    return;
  }
  console.log(`✓ Job generated from booking: ${jobId}`);

  // 4. Assign Job
  console.log('\n--- ASSIGNING JOB ---');
  const assignRes = await axios.patch(`${API_URL}/jobs/${jobId}/assign`, {
    assigned_user_id: tech.id
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log(`✓ Job assigned to Tech (${tech.id}). Status: ${assignRes.data.data.status}`);

  // 5. Complete Job (simulate tech action)
  console.log('\n--- COMPLETING JOB ---');
  await prisma.jobMedia.createMany({
    data: [
      { job_id: jobId, url: 'mock1.jpg', type: 'Image', category: 'After', uploaded_by: tech.id },
      { job_id: jobId, url: 'mock2.jpg', type: 'Image', category: 'After', uploaded_by: tech.id },
      { job_id: jobId, url: 'mock3.jpg', type: 'Image', category: 'After', uploaded_by: tech.id }
    ]
  });
  const completeRes = await axios.patch(`${API_URL}/jobs/${jobId}/status`, {
    status: 'Completed',
    actual_start: new Date(Date.now() - 3600000).toISOString(),
    actual_end: new Date().toISOString(),
    completionNotes: 'E2E Job completed successfully.'
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log(`✓ Job completed.`);

  // 6. Fetch Auto-generated Invoice
  console.log('\n--- VERIFYING INVOICE ---');
  let invoiceId: string | undefined;
  for (let i = 0; i < 5; i++) {
    const invoice = await prisma.invoice.findFirst({ where: { booking_id: bookingId } });
    if (invoice) {
      invoiceId = invoice.id;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  if (!invoiceId) {
    console.error('❌ Auto-generated Invoice NOT FOUND in DB');
    return;
  }
  
  const invoiceRes = await axios.get(`${API_URL}/invoices/${invoiceId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log(`✓ Invoice auto-generated and verified via API: ${invoiceRes.data.data.invoice_number}`);
  
  // 6.5 Issue Invoice
  await axios.patch(`${API_URL}/invoices/${invoiceId}/status`, {
    status: 'Issued'
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log(`✓ Invoice marked as Issued.`);

  // 7. Generate Payment
  console.log('\n--- RECORDING PAYMENT ---');
  const paymentRes = await axios.post(`${API_URL}/payments`, {
    invoice_id: invoiceId,
    amount: Number(invoiceRes.data.data.final_amount),
    payment_method: 'Cash',
    reference_number: 'CASH-E2E-1'
  }, { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log(`✓ Payment recorded. Amount: ${paymentRes.data.data.amount}`);

  // 8. DB Verification vs API Verification (Dashboard)
  console.log('\n--- DATABASE vs API VERIFICATION (DASHBOARD) ---');
  // API Call
  const dashboardRes = await axios.get(`${API_URL}/dashboard/kpis`, { headers: { Authorization: `Bearer ${adminToken}` } });
  const apiJobsToday = dashboardRes.data.data.jobs_today;
  
  // DB Direct
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setUTCHours(23, 59, 59, 999);
  const dbJobsToday = await prisma.job.count({
    where: { scheduled_start: { gte: todayStart, lte: todayEnd }, status: { notIn: ['Cancelled'] } }
  });

  console.log(`API jobs_today: ${apiJobsToday}`);
  console.log(`DB jobs_today count: ${dbJobsToday}`);
  console.log(apiJobsToday === dbJobsToday ? '✓ Dashboard matches DB exactly.' : '❌ Dashboard mismatch!');

  console.log('\n--- E2E REGRESSION SUITE COMPLETED ---');
  } catch (e: any) {
    if (e.response) {
      console.error('API Error:', JSON.stringify(e.response.data, null, 2));
    } else {
      console.error('Network/Script Error:', e.message);
    }
  }
}

runRegression().finally(() => prisma.$disconnect());
