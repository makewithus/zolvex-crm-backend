import { PrismaClient, ComplaintStatus, LeadStatus, InvoiceStatus, PaymentStatus, ExpenseStatus } from '@prisma/client';

const prisma = new PrismaClient();

export const getAlertsSummary = async (user: any) => {
  const isApprover = ['Super Admin', 'Finance'].includes(user?.role);

  const [openComplaints, newLeads, dueFollowUps, unpaidInvoices, pendingExpenses, rejectedExpenses] = await Promise.all([
    prisma.complaint.count({
      where: { status: ComplaintStatus.Open },
    }),
    prisma.lead.count({
      where: { status: LeadStatus.New },
    }),
    prisma.lead.count({
      where: { 
        status: LeadStatus.FollowUp,
        follow_up_date: { lte: new Date() }
      },
    }),
    prisma.invoice.count({
      where: {
        status: InvoiceStatus.Issued,
        payment_status: PaymentStatus.Unpaid,
      },
    }),
    isApprover ? prisma.expense.count({ where: { status: ExpenseStatus.Submitted } }) : Promise.resolve(0),
    prisma.expense.count({ where: { status: ExpenseStatus.Rejected, created_by: user?.id } }),
  ]);

  return {
    openComplaints,
    newLeads,
    dueFollowUps,
    unpaidInvoices,
    pendingExpenses,
    rejectedExpenses,
    total: openComplaints + newLeads + dueFollowUps + unpaidInvoices + pendingExpenses + rejectedExpenses,
  };
};
