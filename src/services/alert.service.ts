import { PrismaClient, ComplaintStatus, LeadStatus, InvoiceStatus, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();

export const getAlertsSummary = async () => {
  const [openComplaints, newLeads, unpaidInvoices] = await Promise.all([
    prisma.complaint.count({
      where: { status: ComplaintStatus.Open },
    }),
    prisma.lead.count({
      where: { status: LeadStatus.New },
    }),
    prisma.invoice.count({
      where: {
        status: InvoiceStatus.Issued,
        payment_status: PaymentStatus.Unpaid,
      },
    }),
  ]);

  return {
    openComplaints,
    newLeads,
    unpaidInvoices,
    total: openComplaints + newLeads + unpaidInvoices,
  };
};
