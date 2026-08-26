/**
 * ExpenseService — Finance Module (Additive)
 *
 * Ownership:
 *   - Manages: Expense, ExpenseSequence
 *   - NEVER modifies: Booking, Invoice, Payment, Job, Lead, PricingRule, GST
 *   - Receipt uploads: handled by caller via existing media.service.ts
 *
 * Status lifecycle: Draft → Submitted → Approved / Rejected
 */

import { PrismaClient, ExpenseCategory, ExpenseStatus } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateExpenseInput {
  category:     ExpenseCategory;
  amount:       number;
  expense_date: Date;
  description:  string;
  vendor_name?: string;
  city_id?:     string;
  created_by:   string;
}

export interface UpdateExpenseInput {
  category?:     ExpenseCategory;
  amount?:       number;
  expense_date?: Date;
  description?:  string;
  vendor_name?:  string;
  city_id?:      string;
}

// ─── Sequence Generator ───────────────────────────────────────────────────────

async function generateExpenseNumber(): Promise<{ number: string; seq: number }> {
  const seq = await prisma.expenseSequence.upsert({
    where:  { id: 1 },
    update: { value: { increment: 1 } },
    create: { id: 1, value: 1 },
  });

  const now = new Date();
  const yy  = now.getFullYear().toString().slice(2);
  const mm  = (now.getMonth() + 1).toString().padStart(2, '0');
  const seq3 = seq.value.toString().padStart(3, '0');

  return { number: `EXP-${yy}${mm}-${seq3}`, seq: seq.value };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ExpenseService {

  /** Create a new Expense (status: Draft) */
  static async createExpense(input: CreateExpenseInput) {
    const { number, seq } = await generateExpenseNumber();

    return prisma.expense.create({
      data: {
        expense_number:  number,
        sequence_number: seq,
        category:        input.category,
        amount:          input.amount,
        expense_date:    input.expense_date,
        description:     input.description,
        vendor_name:     input.vendor_name,
        city_id:         input.city_id,
        status:          ExpenseStatus.Draft,
        created_by:      input.created_by,
      },
      include: { city: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    });
  }

  /** Update a Draft expense */
  static async updateExpense(id: string, input: UpdateExpenseInput, requesting_user_id: string) {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });

    if (expense.status !== ExpenseStatus.Draft) {
      throw new AppError(`Only Draft expenses can be edited. Current status: ${expense.status}`, 400);
    }

    // Check ownership or Super Admin — enforced at controller/RBAC level
    return prisma.expense.update({
      where: { id },
      data:  input,
      include: { city: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    });
  }

  /** Submit a Draft expense (Draft → Submitted) */
  static async submitExpense(id: string) {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });

    if (expense.status !== ExpenseStatus.Draft) {
      throw new AppError(`Only Draft expenses can be submitted. Current status: ${expense.status}`, 400);
    }

    return prisma.expense.update({
      where: { id },
      data:  { status: ExpenseStatus.Submitted },
    });
  }

  /** Approve a Submitted expense (Submitted → Approved) */
  static async approveExpense(id: string, approved_by: string) {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });

    if (expense.status !== ExpenseStatus.Submitted) {
      throw new AppError(`Only Submitted expenses can be approved. Current status: ${expense.status}`, 400);
    }

    return prisma.expense.update({
      where: { id },
      data:  { status: ExpenseStatus.Approved, approved_by },
    });
  }

  /** Reject a Submitted expense (Submitted → Rejected) */
  static async rejectExpense(id: string, approved_by: string) {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });

    if (expense.status !== ExpenseStatus.Submitted) {
      throw new AppError(`Only Submitted expenses can be rejected. Current status: ${expense.status}`, 400);
    }

    return prisma.expense.update({
      where: { id },
      data:  { status: ExpenseStatus.Rejected, approved_by },
    });
  }

  /** Attach receipt URL (set by caller after R2 upload) */
  static async attachReceipt(id: string, receipt_url: string) {
    return prisma.expense.update({
      where: { id },
      data:  { receipt_url },
    });
  }

  /** Delete a Draft expense (only) */
  static async deleteExpense(id: string) {
    const expense = await prisma.expense.findUniqueOrThrow({ where: { id } });

    if (expense.status !== ExpenseStatus.Draft) {
      throw new AppError(`Only Draft expenses can be deleted. Current status: ${expense.status}`, 400);
    }

    return prisma.expense.delete({ where: { id } });
  }

  /** Get a single expense by ID */
  static async getExpenseById(id: string) {
    return prisma.expense.findUniqueOrThrow({
      where:   { id },
      include: {
        city:       { select: { id: true, name: true } },
        createdBy:  { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
  }

  /** List expenses with optional filters — RBAC filtering applied by caller */
  static async listExpenses(where: object) {
    return prisma.expense.findMany({
      where,
      include: {
        city:      { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
