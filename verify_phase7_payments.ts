import { PrismaClient, Prisma, PaymentMethod } from '@prisma/client';
import { recordPayment } from './src/services/payment.service';
import { generateInvoiceFromBooking, updateInvoiceStatus } from './src/services/invoice.service';
import { convertLeadToBooking } from './src/services/booking.service';

const prisma = new PrismaClient();
const SYS_USER = '00000000-0000-0000-0000-000000000001';

async function setupTestData() {
  console.log('[Setup] Preparing test data...');
  const user = await prisma.user.findFirst({ where: { role: { name: 'Super Admin' } }, include: { role: true } });
  if (!user) throw new Error('No Super Admin found');

  const city = await prisma.city.findFirst();
  const service = await prisma.service.findFirst();
  if (!city || !service) throw new Error('Missing city/service');

  // Ensure Pricing Rule is 1000 Base, 0% Tax for clean math
  let pr = await prisma.pricingRule.findFirst({ where: { service_id: service.id } });
  if (!pr) {
    pr = await prisma.pricingRule.create({
      data: { service_id: service.id, base_price: 1000, cgst_percent: 0, sgst_percent: 0, igst_percent: 0 }
    });
  } else {
    await prisma.pricingRule.update({
      where: { id: pr.id },
      data: { base_price: 1000, cgst_percent: 0, sgst_percent: 0, igst_percent: 0 }
    });
  }

  // Create Customer & Booking
  const customer = await prisma.customer.create({
    data: { name: 'Payment Tester', phone: `99${Math.floor(Math.random() * 100000000)}` }
  });

  const booking = await prisma.booking.create({
    data: {
      booking_id: `BKG-TEST-${Date.now()}`,
      customer_id: customer.id,
      customer_phone: customer.phone,
      city_id: city.id,
      city_name: city.name,
      service_id: service.id,
      service_name: service.name,
      scheduled_date: new Date(),
      slot: 'Morning',
      address_line_1: 'Test Addr',
      postal_code: '400001',
      state: 'Maharashtra',
      base_price: 1000,
      tax: 0,
      final_amount: 1000,
      status: 'Completed',
      created_by: user.id,
      job: {
        create: {
          job_id: `JOB-TEST-${Date.now()}`,
          status: 'Completed',
          scheduled_start: new Date(),
          scheduled_end: new Date(),
          created_by: user.id
        }
      }
    }
  });

  return { user, booking };
}

async function verifyGate(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ [${name}] Passed`);
  } catch (error: any) {
    console.error(`❌ [${name}] Failed:`, error.message || error);
    process.exit(1);
  }
}

async function verifyGateFail(name: string, fn: () => Promise<void>, expectedError: string) {
  try {
    await fn();
    console.error(`❌ [${name}] Failed: Expected error containing "${expectedError}" but succeeded.`);
    process.exit(1);
  } catch (error: any) {
    if (error.message.includes(expectedError)) {
      console.log(`✅ [${name}] Passed (Caught expected: ${error.message})`);
    } else {
      console.error(`❌ [${name}] Failed: Wrong error message. Expected "${expectedError}", got "${error.message}"`);
      process.exit(1);
    }
  }
}

async function run() {
  console.log('--- PHASE 7: PAYMENTS VERIFICATION ---');
  
  const { user, booking } = await setupTestData();

  // Create Invoice
  const invoiceDraft = await generateInvoiceFromBooking(booking.id, user.id);
  const invoiceId = invoiceDraft.id;

  // Gate 5: Attempt payment on Draft invoice
  await verifyGateFail('Gate 5: Draft invoice payment rejected', async () => {
    await recordPayment({ invoice_id: invoiceId, amount: 400, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin');
  }, 'must be Issued');

  // Issue the Invoice
  await updateInvoiceStatus(invoiceId, 'Issued', user.id, 'Super Admin');

  // Gate 1: Pay 400 -> Partial
  await verifyGate('Gate 1: Pay ₹400 -> Partial', async () => {
    await recordPayment({ invoice_id: invoiceId, amount: 400, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin');
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (Number(inv?.amount_paid) !== 400) throw new Error(`amount_paid is ${inv?.amount_paid}`);
    if (Number(inv?.balance_due) !== 600) throw new Error(`balance_due is ${inv?.balance_due}`);
    if (inv?.payment_status !== 'Partial') throw new Error(`payment_status is ${inv?.payment_status}`);
  });

  // Gate 4: Overpayment
  await verifyGateFail('Gate 4: Overpayment rejected', async () => {
    await recordPayment({ invoice_id: invoiceId, amount: 1200, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin');
  }, 'exceeds balance due');

  // Gate 2: Pay 600 -> Paid
  await verifyGate('Gate 2: Pay ₹600 -> Paid', async () => {
    await recordPayment({ invoice_id: invoiceId, amount: 600, payment_method: PaymentMethod.Cash }, user.id, 'Super Admin');
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (Number(inv?.amount_paid) !== 1000) throw new Error(`amount_paid is ${inv?.amount_paid}`);
    if (Number(inv?.balance_due) !== 0) throw new Error(`balance_due is ${inv?.balance_due}`);
    if (inv?.payment_status !== 'Paid') throw new Error(`payment_status is ${inv?.payment_status}`);
  });

  // Gate 3: Payment on fully paid
  await verifyGateFail('Gate 3: Payment on fully paid rejected', async () => {
    await recordPayment({ invoice_id: invoiceId, amount: 10, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin');
  }, 'already fully paid');

  // Gate 6: Cancelled invoice payment
  // @ts-ignore
  const booking2 = await prisma.booking.create({ data: { ...booking, id: undefined, booking_id: `BKG-TEST-${Date.now()+1}`, status: 'Completed', job: { create: { job_id: `JOB-TEST-${Date.now()+1}`, status: 'Completed', scheduled_start: new Date(), scheduled_end: new Date(), created_by: user.id } } } });
  const invoiceDraft2 = await generateInvoiceFromBooking(booking2.id, user.id);
  await updateInvoiceStatus(invoiceDraft2.id, 'Cancelled', user.id, 'Super Admin');
  
  await verifyGateFail('Gate 6: Cancelled invoice payment rejected', async () => {
    await recordPayment({ invoice_id: invoiceDraft2.id, amount: 100, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin');
  }, 'Cancelled invoice');

  // Gate 7: Verify InvoiceHistory
  await verifyGate('Gate 7: Verify InvoiceHistory contains payment entries', async () => {
    const logs = await prisma.invoiceHistory.findMany({ where: { invoice_id: invoiceId, action: { contains: 'Payment Recorded' } } });
    if (logs.length !== 2) throw new Error(`Expected 2 payment logs, found ${logs.length}`);
  });

  // Gate 8: Verify PaymentHistory
  await verifyGate('Gate 8: Verify PaymentHistory contains creation entry', async () => {
    const payment = await prisma.payment.findFirst({ where: { invoice_id: invoiceId } });
    const logs = await prisma.paymentHistory.findMany({ where: { payment_id: payment!.id } });
    if (logs.length !== 1) throw new Error(`Expected 1 payment history log, found ${logs.length}`);
    if (logs[0].action !== 'Created') throw new Error('Expected action Created');
  });

  // Gate 9: Concurrent payment test
  await verifyGate('Gate 9: Concurrent payment race condition test', async () => {
    // @ts-ignore
    const booking3 = await prisma.booking.create({ data: { ...booking, id: undefined, booking_id: `BKG-TEST-${Date.now()+2}`, status: 'Completed', job: { create: { job_id: `JOB-TEST-${Date.now()+2}`, status: 'Completed', scheduled_start: new Date(), scheduled_end: new Date(), created_by: user.id } } } });
    const inv = await generateInvoiceFromBooking(booking3.id, user.id);
    await updateInvoiceStatus(inv.id, 'Issued', user.id, 'Super Admin');

    console.log('       Triggering 3 simultaneous payment requests of ₹500 (Invoice total is ₹1000)...');
    const promises = [
      recordPayment({ invoice_id: inv.id, amount: 500, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin').catch(e => e.message),
      recordPayment({ invoice_id: inv.id, amount: 500, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin').catch(e => e.message),
      recordPayment({ invoice_id: inv.id, amount: 500, payment_method: PaymentMethod.UPI }, user.id, 'Super Admin').catch(e => e.message)
    ];

    const results = await Promise.all(promises);
    
    // 2 should succeed, 1 should fail
    const successes = results.filter(r => typeof r === 'object');
    const failures = results.filter(r => typeof r === 'string');
    
    if (successes.length !== 2) throw new Error(`Expected 2 successful payments, got ${successes.length}`);
    if (failures.length !== 1) throw new Error(`Expected 1 failure, got ${failures.length}`);
    if (!failures[0].includes('fully paid') && !failures[0].includes('exceeds')) {
       throw new Error(`Unexpected failure reason: ${failures[0]}`);
    }

    const finalInv = await prisma.invoice.findUnique({ where: { id: inv.id } });
    if (Number(finalInv?.amount_paid) !== 1000) throw new Error(`Race condition failed! Amount paid is ${finalInv?.amount_paid}`);
    
    // Check no duplicate receipts
    const receipts = successes.map(s => s.payment_number);
    if (new Set(receipts).size !== 2) throw new Error(`Duplicate receipts generated: ${receipts}`);
  });

  console.log('==========================================');
  console.log('✅ ALL PAYMENT GATES PASSED SUCCESSFULLY');
  console.log('==========================================');
}

run().catch(e => console.error(e)).finally(() => prisma.$disconnect());
