const { PrismaClient } = require('@prisma/client');
const { QuoteService } = require('./dist/services/quote.service');
const { createQuoteSchema, updateQuoteSchema } = require('./dist/validations/quote.validation');

const prisma = new PrismaClient();

async function run() {
  try {
    const lead = await prisma.lead.findFirst({
      where: { status: 'New' },
      orderBy: { created_at: 'desc' },
      include: { customer: true }
    });
    const admin = await prisma.user.findFirst();
    const customer_id = lead ? lead.customer_id : (await prisma.customer.findFirst()).id;
    const lead_id = lead ? lead.id : undefined;

    console.log('\n--- Test 1: New quote with ₹0 discount ---');
    const payload1 = {
      customer_id,
      lead_id,
      subject: "Test Discount 0",
      description: "",
      notes: "",
      discount_amount: 0,
      line_items: [
        { description: "Item 1", quantity: 1, unit_price: 1000, tax_percent: 18 } // Subtotal 1000, Tax 180, Total 1180
      ]
    };
    
    let res1 = createQuoteSchema.validate(payload1);
    if (res1.error) throw new Error(res1.error.details[0].message);
    const quote1 = await QuoteService.createQuote({...res1.value, created_by: admin.id});
    console.log(`Quote ${quote1.quote_id} Totals -> Subtotal: ${quote1.subtotal}, Discount: ${quote1.discount_amount}, Tax: ${quote1.tax_amount}, Total: ${quote1.total_amount}`);
    if (Number(quote1.total_amount) !== 1180) throw new Error('Test 1 Failed');

    console.log('\n--- Test 2: New quote with ₹100 discount ---');
    const payload2 = {
      customer_id,
      lead_id,
      subject: "Test Discount 100",
      description: "",
      notes: "",
      discount_amount: 100,
      line_items: [
        { description: "Item 1", quantity: 1, unit_price: 1000, tax_percent: 18 }
      ]
    };
    let res2 = createQuoteSchema.validate(payload2);
    if (res2.error) throw new Error(res2.error.details[0].message);
    const quote2 = await QuoteService.createQuote({...res2.value, created_by: admin.id});
    // Expected: Subtotal 1000, Discount 100, Tax 180, Total = 1000 - 100 + 180 = 1080
    console.log(`Quote ${quote2.quote_id} Totals -> Subtotal: ${quote2.subtotal}, Discount: ${quote2.discount_amount}, Tax: ${quote2.tax_amount}, Total: ${quote2.total_amount}`);
    if (Number(quote2.total_amount) !== 1080) throw new Error('Test 2 Failed');

    console.log('\n--- Test 3: Discount > subtotal ---');
    const payload3 = {
      customer_id,
      subject: "Test Discount Exceed",
      discount_amount: 2000,
      line_items: [
        { description: "Item 1", quantity: 1, unit_price: 1000, tax_percent: 18 }
      ]
    };
    try {
      let res3 = createQuoteSchema.validate(payload3);
      if (res3.error) throw new Error(res3.error.details[0].message);
      await QuoteService.createQuote({...res3.value, created_by: admin.id});
      throw new Error("Should have thrown error");
    } catch (e) {
      console.log('Successfully caught error:', e.message);
      if (!e.message.includes('cannot exceed subtotal')) throw e;
    }

    console.log('\n--- Test 4: Negative discount ---');
    const payload4 = {
      ...payload3,
      discount_amount: -50
    };
    try {
      let res4 = createQuoteSchema.validate(payload4);
      if (res4.error) throw new Error(res4.error.details[0].message); // Should fail Joi validation first!
      await QuoteService.createQuote({...res4.value, created_by: admin.id});
      throw new Error("Should have thrown error");
    } catch (e) {
      console.log('Successfully caught error:', e.message);
      if (!e.message.includes('"discount_amount" must be greater than or equal to 0')) throw e;
    }

    console.log('\n--- Test 5: Multiple line items ---');
    const payload5 = {
      customer_id,
      subject: "Test Multiple Items",
      discount_amount: 150,
      line_items: [
        { description: "Item 1", quantity: 2, unit_price: 500, tax_percent: 18 }, // 1000 (tax 180)
        { description: "Item 2", quantity: 1, unit_price: 200, tax_percent: 5 }   // 200  (tax 10)
      ]
    };
    let res5 = createQuoteSchema.validate(payload5);
    if (res5.error) throw new Error(res5.error.details[0].message);
    const quote5 = await QuoteService.createQuote({...res5.value, created_by: admin.id});
    // Subtotal: 1200. Tax: 190. Discount: 150. Total: 1200 - 150 + 190 = 1240.
    console.log(`Quote ${quote5.quote_id} Totals -> Subtotal: ${quote5.subtotal}, Discount: ${quote5.discount_amount}, Tax: ${quote5.tax_amount}, Total: ${quote5.total_amount}`);
    if (Number(quote5.total_amount) !== 1240) throw new Error('Test 5 Failed');

    console.log('\n--- Test 6: Existing quote with zero discount ---');
    // Simulate updating a quote to trigger computeTotals with no discount provided
    const quote6 = await QuoteService.updateQuote(quote1.id, { subject: "Updated Subject" }, admin.id);
    console.log(`Quote ${quote6.quote_id} Totals -> Subtotal: ${quote6.subtotal}, Discount: ${quote6.discount_amount}, Tax: ${quote6.tax_amount}, Total: ${quote6.total_amount}`);
    if (Number(quote6.total_amount) !== 1180) throw new Error('Test 6 Failed');

    console.log('\n--- Test 7: Quote sending and QuotationSent transition ---');
    if (lead_id) {
       await prisma.lead.update({ where: { id: lead_id }, data: { status: 'Qualified' } });
       console.log('Set lead to Qualified');
       await QuoteService.sendQuote(quote2.id, admin.id, "Here is your quote");
       console.log('Quote marked as Sent.');
       // wait for async event transition
       await new Promise(r => setTimeout(r, 1000));
       const refreshedLead = await prisma.lead.findUnique({ where: { id: lead_id } });
       console.log('Lead Status after Quote Sent:', refreshedLead.status);
       if (refreshedLead.status !== 'QuotationSent') throw new Error('Test 7 Failed');
    } else {
       console.log('No lead available to test transition.');
    }
    
    console.log('\nALL TESTS PASSED.');

  } catch (err) {
    console.error('Test execution failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
