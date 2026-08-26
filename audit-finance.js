const { PrismaClient } = require('@prisma/client');
const { QuoteService } = require('./dist/services/quote.service');
const { InvoiceService } = require('./dist/services/invoice.service');
const { PaymentService } = require('./dist/services/payment.service');
const { ExpenseService } = require('./dist/services/expense.service');
const { getRevenueSummary, getOutstandingSummary, getCollectionsSummary, getExpenseSummary, getGSTSummary, getQuotationSummary } = require('./dist/services/report.service');
const { createBooking } = require('./dist/services/booking.service');

const prisma = new PrismaClient();

const BUGS = [];
function reportBug(severity, title, expected, actual, file) {
  BUGS.push({ severity, title, expected, actual, file });
  console.error(`[BUG ${severity}] ${title} | Expected: ${expected} | Actual: ${actual}`);
}

async function runAudit() {
  try {
    let admin = await prisma.user.findFirst();
    if (!admin) {
        let role = await prisma.role.findFirst();
        if (!role) role = await prisma.role.create({ data: { name: 'SuperAdmin' }});
        admin = await prisma.user.create({ data: { name: 'Test', phone: '1234567890', password_hash: '123', role_id: role.id } });
    }

    let customer = await prisma.customer.findFirst();
    if (!customer) customer = await prisma.customer.create({ data: { name: 'Cust', phone: '0987654321' }});
    
    let city = await prisma.city.findFirst();
    if (!city) city = await prisma.city.create({ data: { name: 'City' }});

    console.log('--- STARTING FULL FINANCE INTEGRATION AUDIT ---');

    console.log('\n--- 1. Testing Quote -> Booking -> Invoice -> Payment Chain ---');
    
    const quotePayload = {
      customer_id: customer.id,
      subject: "Audit Quote",
      discount_amount: 1000,
      line_items: [
        { description: "AC Service", quantity: 2, unit_price: 5000, tax_percent: 18 }
      ],
      created_by: admin.id
    };
    
    let quote;
    try {
      quote = await QuoteService.createQuote(quotePayload);
      console.log(`Quote created: ${quote.quote_id} | Subtotal: ${quote.subtotal}, Discount: ${quote.discount_amount}, Tax: ${quote.tax_amount}, Total: ${quote.total_amount}`);
      if (Number(quote.total_amount) !== 10800) {
        reportBug('Major', 'Quote Math Error', '10800', quote.total_amount, 'quote.service.ts');
      }
    } catch (e) {
      reportBug('Critical', 'Quote Creation Failed', 'Success', e.message, 'quote.service.ts');
    }

    let booking;
    try {
       booking = await createBooking({
         customer_id: customer.id,
         city_id: city.id,
         address: "123 Test St",
         scheduled_at: new Date(Date.now() + 86400000),
         line_items: [
           { description: "AC Service", quantity: 2, unit_price: 5000, tax_percent: 18 }
         ]
       }, admin.id);
       console.log(`Booking created: ${booking.booking_id} | Subtotal: ${booking.subtotal}, Tax: ${booking.tax_amount}, Total: ${booking.total_amount}`);
       
       if (Number(booking.total_amount) !== 11800) { 
         reportBug('Major', 'Booking Math Error', '11800', booking.total_amount, 'booking.service.ts');
       }
    } catch (e) {
       reportBug('Critical', 'Booking Creation Failed', 'Success', e.message, 'booking.service.ts');
    }

    let invoice;
    try {
      if (booking) {
         await prisma.booking.update({ where: { id: booking.id }, data: { status: 'Completed' } });
         invoice = await InvoiceService.createInvoice(booking.id, admin.id);
         console.log(`Invoice created: ${invoice.invoice_id} | Total: ${invoice.total_amount} | Outstanding: ${invoice.outstanding_amount}`);
         
         if (Number(invoice.total_amount) !== Number(booking.total_amount)) {
            reportBug('Critical', 'Invoice Total Mismatch', booking.total_amount, invoice.total_amount, 'invoice.service.ts');
         }
      }
    } catch (e) {
      reportBug('Critical', 'Invoice Creation Failed', 'Success', e.message, 'invoice.service.ts');
    }

    let payment;
    try {
      if (invoice) {
        payment = await PaymentService.createPayment({
           invoice_id: invoice.id,
           amount: 5000,
           payment_mode: 'Cash',
           reference_id: 'CASH-001',
           recorded_by: admin.id
        });
        console.log(`Payment created: ${payment.payment_id} | Amount: ${payment.amount}`);
        
        const refreshedInvoice = await prisma.invoice.findUnique({ where: { id: invoice.id } });
        if (Number(refreshedInvoice.outstanding_amount) !== (Number(invoice.total_amount) - 5000)) {
           reportBug('Major', 'Invoice Outstanding Amount not syncing', invoice.total_amount - 5000, refreshedInvoice.outstanding_amount, 'payment.service.ts');
        }
        
        if (refreshedInvoice.status !== 'PartiallyPaid') {
           reportBug('Minor', 'Invoice Status not syncing', 'PartiallyPaid', refreshedInvoice.status, 'payment.service.ts');
        }
      }
    } catch (e) {
      reportBug('Critical', 'Payment Creation Failed', 'Success', e.message, 'payment.service.ts');
    }

    try {
      if (invoice) {
         await PaymentService.createPayment({
            invoice_id: invoice.id,
            amount: 100000, 
            payment_mode: 'UPI',
            recorded_by: admin.id
         });
         reportBug('Major', 'Overpayment Protection Failed', 'Throw Error', 'Payment Succeeded', 'payment.service.ts');
      }
    } catch (e) {
      if (!e.message.includes('Payment amount exceeds outstanding balance')) {
        reportBug('Minor', 'Overpayment Error Message', 'Exceeds balance', e.message, 'payment.service.ts');
      } else {
        console.log('Overpayment protection works correctly.');
      }
    }

    console.log('\n--- 2. Testing Expenses ---');
    let expense;
    try {
      expense = await ExpenseService.createExpense({
        category: 'Travel',
        amount: 2000,
        description: 'Audit travel',
        expense_date: new Date(),
        created_by: admin.id
      });
      console.log(`Expense created: ${expense.expense_id} | Status: ${expense.status}`);
      
      await ExpenseService.submitExpense(expense.id, admin.id);
      console.log('Expense submitted for approval.');
      
      await prisma.expense.update({ where: { id: expense.id }, data: { status: 'Approved' } });
      console.log('Expense forced to Approved.');
    } catch (e) {
      reportBug('Critical', 'Expense Flow Failed', 'Success', e.message, 'expense.service.ts');
    }

    console.log('\n--- 3. Testing Reports Sync ---');
    try {
      const filters = { startDate: '2000-01-01', endDate: '2099-12-31' };
      const revenueData = await getRevenueSummary(filters);
      const outstandingData = await getOutstandingSummary(filters);
      const collectionsData = await getCollectionsSummary(filters);
      const expenseData = await getExpenseSummary(filters);

      console.log('Finance Summary Snapshot:');
      console.log(`Revenue: ${revenueData.total}`);
      console.log(`Collections: ${collectionsData.total}`);
      console.log(`Outstanding: ${outstandingData.total}`);
      console.log(`Approved Expenses: ${expenseData.total}`);
      
      const totalInvoices = await prisma.invoice.aggregate({ _sum: { total_amount: true }, where: { status: { not: 'Cancelled' } } });
      if (Number(revenueData.total) !== Number(totalInvoices._sum.total_amount || 0)) {
         reportBug('Critical', 'Revenue mismatch', totalInvoices._sum.total_amount, revenueData.total, 'report.service.ts');
      }

      const totalPayments = await prisma.payment.aggregate({ _sum: { amount: true }, where: { status: 'Success' } });
      if (Number(collectionsData.total) !== Number(totalPayments._sum.amount || 0)) {
         reportBug('Critical', 'Collections mismatch', totalPayments._sum.amount, collectionsData.total, 'report.service.ts');
      }

      const totalExpenses = await prisma.expense.aggregate({ _sum: { amount: true }, where: { status: 'Approved' } });
      if (Number(expenseData.total) !== Number(totalExpenses._sum.amount || 0)) {
         reportBug('Critical', 'Expense reporting mismatch', totalExpenses._sum.amount, expenseData.total, 'report.service.ts');
      }

      const quotationData = await getQuotationSummary(filters);
      console.log(`Sent Quotes: ${quotationData.sent_count}, Accepted: ${quotationData.accepted_count}`);
      
    } catch (e) {
      reportBug('Critical', 'Reports Failed', 'Success', e.message, 'report.service.ts');
    }

    console.log('\n--- BUG REPORT ---');
    if (BUGS.length === 0) {
      console.log('No bugs found in automated tests.');
    } else {
      console.table(BUGS);
    }
    
  } catch (err) {
    console.error('Audit execution failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

runAudit();
