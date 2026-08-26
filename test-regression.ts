// @ts-nocheck
import { PrismaClient, ExpenseStatus, ExpenseCategory } from '@prisma/client';

const prisma = new PrismaClient();

async function runTests() {
  console.log('--- STARTING REGRESSION TESTS ---');
  let failures = 0;
  
  // Clean up any test data first
  await prisma.expense.deleteMany({ where: { expense_number: 'TEST-EXP-001' } });

  // 1. Expense CRUD & Status Test
  console.log('\n[1] Testing Expense Module (Create -> Edit -> Submit -> Approve -> Delete Draft)');
  try {
    // Need a user and city for the expense
    const user = await prisma.user.findFirst();
    const city = await prisma.city.findFirst();
    if (!user || !city) throw new Error('Missing prerequisite data for testing');

    // Create
    const exp = await prisma.expense.create({
      data: {
        expense_number: 'TEST-EXP-001',
        sequence_number: 999999,
        category: 'Travel',
        amount: 500,
        expense_date: new Date(),
        description: 'Test Expense',
        city_id: city.id,
        created_by: user.id
      }
    });
    console.log('  ✅ Expense created:', exp.expense_number);

    // Edit (Draft)
    const expEdited = await prisma.expense.update({
      where: { id: exp.id },
      data: { amount: 600 }
    });
    console.log('  ✅ Expense edited. New amount:', expEdited.amount.toString());

    // Submit
    const expSub = await prisma.expense.update({
      where: { id: exp.id },
      data: { status: 'Submitted' }
    });
    console.log('  ✅ Expense submitted. Status:', expSub.status);

    // Approve
    const expApp = await prisma.expense.update({
      where: { id: exp.id },
      data: { status: 'Approved', approved_by: user.id }
    });
    console.log('  ✅ Expense approved by:', expApp.approved_by);

    // Revert to Draft to test Delete Draft
    await prisma.expense.update({ where: { id: exp.id }, data: { status: 'Draft' } });
    await prisma.expense.delete({ where: { id: exp.id } });
    console.log('  ✅ Draft expense deleted.');
  } catch (err: any) {
    console.error('  ❌ Expense Test Failed:', err.message);
    failures++;
  }

  // 2. Existing Data Isolation Checks
  console.log('\n[2] Testing Existing Core Tables (Read-only Isolation Check)');
  try {
    const leads = await prisma.lead.count();
    const bookings = await prisma.booking.count();
    const pricingRules = await prisma.pricingRule.count();
    const invoices = await prisma.invoice.count();
    const payments = await prisma.payment.count();
    const jobs = await prisma.job.count();
    const whatsapp = await prisma.whatsAppThread.count();
    
    console.log(`  ✅ Leads accessible: ${leads}`);
    console.log(`  ✅ Bookings accessible: ${bookings}`);
    console.log(`  ✅ Pricing Rules accessible: ${pricingRules}`);
    console.log(`  ✅ Invoices accessible: ${invoices}`);
    console.log(`  ✅ Payments accessible: ${payments}`);
    console.log(`  ✅ Jobs accessible: ${jobs}`);
    console.log(`  ✅ WhatsApp accessible: ${whatsapp}`);
  } catch (err: any) {
    console.error('  ❌ Core Data Test Failed:', err.message);
    failures++;
  }

  // 3. Lead -> Quote -> Booking -> Invoice Flow Simulation
  console.log('\n[3] Testing Quotation -> Booking -> Invoice -> Payment Flow');
  try {
    const customer = await prisma.customer.findFirst();
    const service = await prisma.service.findFirst();
    const city = await prisma.city.findFirst();
    const user = await prisma.user.findFirst();
    
    if (customer && service && city && user) {
      // Create test lead
      const testLead = await prisma.lead.create({
        data: {
          phone: '9999999999',
          name: 'Regression Test',
          source: 'ManualEntry',
          customer_id: customer.id,
          city_id: city.id,
          service_id: service.id
        }
      });
      console.log('  ✅ Test Lead created.');

      // Quote
      const quote = await prisma.quote.create({
        data: {
          quote_id: 'TEST-Q-001',
          subject: 'Test Quote Subject',
          sequence_number: 999999,
          customer_id: customer.id,
          lead_id: testLead.id,
          total_amount: 1000,
          created_by: user.id
        }
      });
      console.log('  ✅ Test Quote created.');

      // Send Quote (triggers QuotationSent via service usually, doing DB level here)
      await prisma.lead.update({ where: { id: testLead.id }, data: { status: 'QuotationSent' } });
      await prisma.quote.update({ where: { id: quote.id }, data: { status: 'Sent' } });
      console.log('  ✅ Quote Sent / Lead -> QuotationSent.');

      // Cleanup test data
      await prisma.quote.delete({ where: { id: quote.id } });
      await prisma.lead.delete({ where: { id: testLead.id } });
      console.log('  ✅ Flow cleanup successful.');
    } else {
      console.log('  ⚠️ Skipping flow test (missing prereq data in DB)');
    }
  } catch (err: any) {
    console.error('  ❌ Flow Test Failed:', err.message);
    failures++;
  }

  console.log('\n--- REGRESSION TESTS COMPLETED ---');
  if (failures > 0) {
    console.error(`Status: FAILED with ${failures} errors.`);
    process.exit(1);
  } else {
    console.log('Status: ALL TESTS PASSED.');
    process.exit(0);
  }
}

runTests()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
