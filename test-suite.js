const { PrismaClient } = require('@prisma/client');
const { QuoteService } = require('./dist/services/quote.service');

const prisma = new PrismaClient();

async function run() {
  try {
    const newLead = await prisma.lead.findFirst({
      orderBy: { created_at: 'desc' },
      include: { customer: true }
    });
    
    const admin = await prisma.user.findFirst();

    console.log('\n--- Test 1: Create Quote with blank fields ---');
    const payloadBlank = {
      customer_id: newLead.customer_id,
      lead_id: newLead.id,
      subject: "AC Service (Blank Fields)",
      description: "",
      valid_until: new Date("2026-08-27"),
      notes: "",
      line_items: [
        {
          description: "ac gas",
          quantity: 1,
          unit_price: 100,
          tax_percent: 18,
          sort_order: 0
        }
      ]
    };
    
    const { createQuoteSchema, updateQuoteSchema } = require('./dist/validations/quote.validation');
    
    let { error, value } = createQuoteSchema.validate(payloadBlank);
    if (error) {
      console.error('Test 1 Joi Validation Failed:', error.details[0].message);
    } else {
      console.log('Test 1 Joi Validation Passed!');
      const quote1 = await QuoteService.createQuote({...value, created_by: admin.id});
      console.log('Quote created successfully with blank fields. ID:', quote1.quote_id);
      
      console.log('\n--- Test 3: Update Quote with blank fields ---');
      const updatePayload = {
        description: "",
        notes: ""
      };
      let updateRes = updateQuoteSchema.validate(updatePayload);
      if (updateRes.error) {
        console.error('Test 3 Joi Validation Failed:', updateRes.error.details[0].message);
      } else {
         console.log('Test 3 Joi Validation Passed!');
         await QuoteService.updateQuote(quote1.id, updatePayload, admin.id);
         console.log('Quote updated successfully with blank fields.');
      }
      
      console.log('\n--- Test 5: Confirm Lead -> QuotationSent transition ---');
      console.log('Initial Lead Status:', newLead.status);
      
      await QuoteService.sendQuote(quote1.id, admin.id, "Here is your quote");
      console.log('Quote marked as Sent.');
      
      await new Promise(r => setTimeout(r, 1000));
      
      const refreshedLead = await prisma.lead.findUnique({ where: { id: newLead.id } });
      console.log('Lead Status after Quote Sent:', refreshedLead.status);
    }

    console.log('\n--- Test 2: Create Quote with populated fields ---');
    const payloadPopulated = {
      customer_id: newLead.customer_id,
      lead_id: newLead.id,
      subject: "AC Service (Populated Fields)",
      description: "Complete overhaul of the outdoor unit.",
      valid_until: new Date("2026-08-27"),
      notes: "Please have the site ready.",
      line_items: [
        {
          description: "ac gas",
          quantity: 1,
          unit_price: 100,
          tax_percent: 18,
          sort_order: 0
        }
      ]
    };

    let res2 = createQuoteSchema.validate(payloadPopulated);
    if (res2.error) {
      console.error('Test 2 Joi Validation Failed:', res2.error.details[0].message);
    } else {
      console.log('Test 2 Joi Validation Passed!');
      const quote2 = await QuoteService.createQuote({...res2.value, created_by: admin.id});
      console.log('Quote created successfully with populated fields. ID:', quote2.quote_id);
    }

  } catch (err) {
    console.error('Test execution failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
