import { PrismaClient, Prisma, PaymentMethod } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { eventBus } from '../events/eventBus';

const prisma = new PrismaClient();

const formatReceiptNumber = (date: Date, seq: number): string => {
  const yy = date.getFullYear().toString().slice(2);
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const seqStr = seq.toString().padStart(4, '0');
  return `RCPT-${yy}${mm}-${seqStr}`;
};

export const recordPayment = async (data: {
  invoice_id: string;
  amount: number;
  payment_method: PaymentMethod;
  payment_date?: string; // ISO date string, defaults to now()
  payment_metadata?: any;
  notes?: string;
  reason?: string;
}, userId: string, userRole: string, ipAddress?: string) => {
  const payment = await prisma.$transaction(async (tx) => {
    // 1. Verify and Lock Invoice (Prevents concurrent race conditions)
    const lockedInvoice = await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${data.invoice_id} FOR UPDATE`;
    if (!lockedInvoice || (lockedInvoice as any[]).length === 0) throw new AppError('Invoice not found', 404);

    const invoice = await tx.invoice.findUnique({
      where: { id: data.invoice_id }
    });

    if (!invoice) throw new AppError('Invoice not found', 404);

    // Fetch booking to get customer_id
    const booking = await tx.booking.findUnique({
      where: { id: invoice.booking_id }
    });
    if (!booking) throw new AppError('Booking not found for this invoice', 404);

    // 2. Business Rules - Invoice Gate
    if (invoice.status === 'Draft') throw new AppError('Invoice must be Issued before accepting payments', 400);
    if (invoice.status === 'Cancelled') throw new AppError('Cannot accept payments on a Cancelled invoice', 400);

    // 3. Math & Balance Validation (Using Decimal for all monetary math)
    const paymentAmount = new Prisma.Decimal(data.amount);
    const balanceDue = new Prisma.Decimal(invoice.balance_due as Prisma.Decimal);
    const amountPaid = new Prisma.Decimal(invoice.amount_paid as Prisma.Decimal);

    if (paymentAmount.lte(0)) throw new AppError('Payment amount must be greater than zero', 400);
    if (balanceDue.lte(0)) throw new AppError('Invoice is already fully paid', 400);
    if (paymentAmount.gt(balanceDue)) throw new AppError(`Payment exceeds balance due (₹${balanceDue.toFixed(2)})`, 400);

    // 4. Generate Sequence Number
    let sequence = await tx.paymentSequence.findFirst();
    if (!sequence) {
      sequence = await tx.paymentSequence.create({ data: { value: 1 } });
    } else {
      sequence = await tx.paymentSequence.update({
        where: { id: sequence.id },
        data: { value: { increment: 1 } }
      });
    }
    const seqNum = sequence.value;
    const paymentNumber = formatReceiptNumber(new Date(), seqNum);

    // 5. Compute New Totals
    const newAmountPaid = amountPaid.plus(paymentAmount);
    const newBalanceDue = balanceDue.minus(paymentAmount);
    
    // Status Logic
    const newPaymentStatus = newBalanceDue.equals(0) ? 'Paid' : 'Partial';

    // 6. Create Payment Record (Immutable)
    const payment = await tx.payment.create({
      data: {
        payment_number: paymentNumber,
        sequence_number: seqNum,
        invoice_id: invoice.id,
        customer_id: booking.customer_id,
        amount: paymentAmount,
        payment_method: data.payment_method,
        payment_status: 'Completed', // For manual payments, immediately complete
        payment_date: data.payment_date ? new Date(data.payment_date) : new Date(),
        payment_metadata: data.payment_metadata || {},
        notes: data.notes,
        recorded_by: userId
      }
    });

    // 7. Create PaymentHistory
    await tx.paymentHistory.create({
      data: {
        payment_id: payment.id,
        action: 'Created',
        changed_by: userId,
        changed_by_role: userRole,
        ip_address: ipAddress,
        reason: data.reason
      }
    });

    // 8. Update Invoice
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amount_paid: newAmountPaid,
        balance_due: newBalanceDue,
        payment_status: newPaymentStatus,
        updated_by: userId
      }
    });

    // 9. Create InvoiceHistory
    await tx.invoiceHistory.create({
      data: {
        invoice_id: invoice.id,
        action: `Payment Recorded: ₹${paymentAmount.toFixed(2)} via ${data.payment_method}`,
        from_status: invoice.status,
        to_status: invoice.status, // Invoice state (Issued) doesn't change, only payment_status does
        changed_by: userId,
        changed_by_role: userRole,
        reason: data.reason || `Payment Receipt: ${paymentNumber}`
      }
    });

    return payment;
  });
  // Publish AFTER the transaction commits — handler sees consistent DB state
  eventBus.publish('Payment.Received', { payment_id: payment.id });
  return payment;
};

export const getPayments = async (filters: { invoice_id?: string; customer_id?: string }) => {
  return prisma.payment.findMany({
    where: filters,
    orderBy: { created_at: 'desc' },
    include: {
      user: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      invoice: { select: { invoice_number: true } }
    }
  });
};

export const getPaymentById = async (id: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      invoice: true,
      history: { orderBy: { changed_at: 'desc' } }
    }
  });
  if (!payment) throw new AppError('Payment not found', 404);
  return payment;
};
