import { PrismaClient, Prisma, InvoiceStatus, PaymentStatus } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { addDays } from 'date-fns';

const prisma = new PrismaClient();

const formatInvoiceNumber = (date: Date, seq: number): string => {
  const yy = date.getFullYear().toString().slice(2);
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const seqStr = seq.toString().padStart(4, '0');
  return `INV-${yy}${mm}-${seqStr}`;
};

export const getInvoiceNextSequence = async () => {
  // Use transaction to ensure safe concurrent increment
  const seq = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    let sequence = await tx.invoiceSequence.findFirst();
    if (!sequence) {
      sequence = await tx.invoiceSequence.create({ data: { value: 1 } });
    } else {
      sequence = await tx.invoiceSequence.update({
        where: { id: sequence.id },
        data: { value: { increment: 1 } }
      });
    }
    return sequence.value;
  });
  return seq;
};

/**
 * INTERNAL: Transaction-aware invoice generation.
 *
 * Must be called with an active Prisma transaction client (tx).
 * Used by job.service.ts so invoice creation is atomic with job completion.
 *
 * NOTHING in this function changes the invoice generation logic.
 * All calculations, GST snapshot, booking snapshot, numbering, and
 * audit history are bit-for-bit identical to the original implementation.
 *
 * @param tx          Active Prisma transaction client
 * @param bookingId
 * @param userId
 * @param autoIssue   true  → Invoice created as 'Issued' (AUTO mode, immediately visible to Reports + Payments)
 *                    false → Invoice created as 'Draft'  (manual flow, requires finance approval)
 * @param manualIssueDate   Optional override for issue date
 * @param manualDueDate     Optional override for due date
 */
export const generateInvoiceFromBookingTx = async (
  tx: Prisma.TransactionClient,
  bookingId: string,
  userId: string,
  autoIssue: boolean = false,
  manualIssueDate?: Date,
  manualDueDate?: Date
) => {
  // 1. Verify Booking exists and Job is Completed
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    include: { job: true, service: true, customer: true }
  });

  if (!booking) throw new AppError('Booking not found', 404);
  if (!booking.job) throw new AppError('Cannot invoice a booking without a Job', 400);
  if (booking.job.status !== 'Completed') throw new AppError(`Cannot invoice a booking with an incomplete Job (${booking.job.status})`, 400);

  // 2. Duplicate Protection
  const existing = await tx.invoice.findUnique({ where: { booking_id: bookingId } });
  if (existing) throw new AppError('Invoice already exists for this Booking', 409);

  // 3. Generate Sequence
  // In a real high-concurrency app, sequence generation should lock the sequence table row.
  // For simplicity, we are executing inside this main transaction.
  let sequence = await tx.invoiceSequence.findFirst();
  if (!sequence) {
    sequence = await tx.invoiceSequence.create({ data: { value: 1 } });
  } else {
    sequence = await tx.invoiceSequence.update({
      where: { id: sequence.id },
      data: { value: { increment: 1 } }
    });
  }
  const seqNum = sequence.value;

  const issueDate = manualIssueDate || new Date();
  // Use default payment terms of 7 days if not provided
  const dueDate = manualDueDate || addDays(issueDate, 7);
  const invoiceNumber = formatInvoiceNumber(issueDate, seqNum);

  // Snapshot pricing logic (assuming Indian Taxes: 9% CGST, 9% SGST of final amount logic if not specified in booking)
  // The previous booking architecture had 'tax' field which we split here if it was flat, or just map.
  // Assuming 18% total GST logic for snapshot (9% CGST, 9% SGST)
  // GST snapshot — read from Booking, NEVER recalculated
  const baseAmt = Number(booking.base_price);
  const discAmt = Number(booking.discount);
  const totalTax = Number(booking.tax);
  const finalAmt = Number(booking.final_amount);

  // GST Snapshot perfectly mapped from Booking
  const cgstPercent = Number(booking.cgst_percent);
  const cgstAmount = Number(booking.cgst_amount);
  const sgstPercent = Number(booking.sgst_percent);
  const sgstAmount = Number(booking.sgst_amount);
  const igstPercent = Number(booking.igst_percent);
  const igstAmount = Number(booking.igst_amount);

  // 4. Determine initial status
  // AUTO mode  → 'Issued': immediately visible to Reports and Payments
  // Manual mode → 'Draft': requires finance to explicitly issue via updateInvoiceStatus()
  const initialStatus = autoIssue ? 'Issued' : 'Draft';

  // 5. Create Invoice (snapshot of booking at point of completion)
  const invoice = await tx.invoice.create({
    data: {
      invoice_number: invoiceNumber,
      sequence_number: seqNum,
      booking_id: booking.id,
      city_id: booking.city_id,
      technician_id: booking.job.assigned_user_id,
      issue_date: issueDate,
      due_date: dueDate,

      // Snapshot — copied exactly once from Booking, never recalculated
      customer_name: booking.customer_name || booking.customer.name,
      customer_phone: booking.customer_phone,
      billing_address: `${booking.address_line_1}, ${booking.city_name}, ${booking.state} ${booking.postal_code}`,
      service_name: booking.service_name,

      // Financials — from GST snapshot on Booking
      base_amount: baseAmt,
      discount_amount: discAmt,
      cgst_percent: cgstPercent,
      cgst_amount: cgstAmount,
      sgst_percent: sgstPercent,
      sgst_amount: sgstAmount,
      igst_percent: igstPercent,
      igst_amount: igstAmount,
      total_tax_amount: totalTax,
      final_amount: finalAmt,
      pricing_snapshot_json: booking.pricing_snapshot_json || {},

      status: initialStatus,
      payment_status: 'Unpaid',
      balance_due: finalAmt,
      created_by: userId,
      updated_by: userId
    }
  });

  // 6. Create InvoiceItem
  await tx.invoiceItem.create({
    data: {
      invoice_id: invoice.id,
      service_name: booking.service_name,
      quantity: 1,
      unit_price: baseAmt,
      discount_amount: discAmt,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      igst_amount: igstAmount,
      line_total: finalAmt
    }
  });

  // 7. Create InvoiceHistory
  await tx.invoiceHistory.create({
    data: {
      invoice_id: invoice.id,
      action: 'Created',
      to_status: initialStatus,
      changed_by: userId,
      reason: autoIssue
        ? 'Auto-generated and issued upon Job completion (AUTO mode)'
        : 'Auto-generated upon Job completion'
    }
  });

  return invoice;
};

/**
 * PUBLIC WRAPPER — backward-compatible, used by invoice.controller.ts (manual API flow).
 *
 * Signature is UNCHANGED. No regressions for existing callers.
 * Creates its own prisma.$transaction. Always uses autoIssue=false → status='Draft'.
 * Finance must explicitly call updateInvoiceStatus() to issue the invoice.
 */
export const generateInvoiceFromBooking = async (bookingId: string, userId: string, manualIssueDate?: Date, manualDueDate?: Date) => {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    return generateInvoiceFromBookingTx(tx, bookingId, userId, false, manualIssueDate, manualDueDate);
  });
};

export const updateInvoiceStatus = async (id: string, newStatus: InvoiceStatus, userId: string, userRole: string, reason?: string) => {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const invoice = await tx.invoice.findUnique({ where: { id } });
    if (!invoice) throw new AppError('Invoice not found', 404);

    if (invoice.status === newStatus) return invoice;

    // Terminal state rules
    if (invoice.status === 'Cancelled') {
      throw new AppError('Cannot change status of a Cancelled invoice', 400);
    }

    // Status rules
    if (newStatus === 'Cancelled' && invoice.payment_status !== 'Unpaid') {
      throw new AppError('Cannot cancel an invoice that has been partially or fully paid', 400);
    }

    const updated = await tx.invoice.update({
      where: { id },
      data: {
        status: newStatus,
        updated_by: userId
      }
    });

    await tx.invoiceHistory.create({
      data: {
        invoice_id: invoice.id,
        action: 'StatusUpdate',
        from_status: invoice.status,
        to_status: newStatus,
        changed_by: userId,
        changed_by_role: userRole,
        reason
      }
    });

    return updated;
  });
};

export const getInvoices = async (filters: any) => {
  return prisma.invoice.findMany({
    where: filters,
    orderBy: { created_at: 'desc' },
    include: {
      items: true
    }
  });
};

export const getInvoiceById = async (id: string) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      items: true,
      history: { orderBy: { changed_at: 'desc' } }
    }
  });
  if (!invoice) throw new AppError('Invoice not found', 404);
  return invoice;
};

export const getCustomerLedger = async (customerId: string) => {
  // Finds invoices by joining customer phone
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const invoices = await prisma.invoice.findMany({
    where: { customer_phone: customer.phone },
    orderBy: { created_at: 'desc' },
    include: { items: true }
  });

  return invoices;
};
