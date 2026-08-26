/**
 * QuoteService — Sprint 11.2 Scaffold
 *
 * Ownership:
 *   - Quote owns: Quote, QuoteLineItem, QuoteTimeline, QuoteSequence
 *   - Never modifies: Booking, Job, Invoice, Customer (read-only)
 *   - Booking conversion: NOT IMPLEMENTED — awaiting client decision
 *     Option A: auto-create Booking on Accept
 *     Option B: mark "Ready for Booking", staff creates manually
 *
 * Event Contract:
 *   Quote.Created  → published on create
 *   Quote.Sent     → published when sent to customer
 *   Quote.Accepted → published when accepted (booking conversion TBD)
 *   Quote.Rejected → published when rejected
 *   Quote.Expired  → published by future cron (Sprint 11.2+)
 */

import { PrismaClient, QuoteStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { eventBus } from '../events/eventBus';

const prisma = new PrismaClient();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LineItemInput {
  service_id?:  string;
  description:  string;
  quantity:     number;
  unit_price:   number;
  tax_percent?: number;
  sort_order?:  number;
}

export interface CreateQuoteInput {
  customer_id: string;
  lead_id?:    string;
  subject:     string;
  description?: string;
  valid_until?: Date;
  notes?:       string;
  terms?:       string;
  discount_amount?: number;
  line_items:   LineItemInput[];
  created_by:   string;
}

export interface UpdateQuoteInput {
  subject?:     string;
  description?: string;
  valid_until?: Date;
  notes?:       string;
  terms?:       string;
  discount_amount?: number;
  line_items?:  LineItemInput[];
}

// ─── Transition Matrix ────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  [QuoteStatus.Draft]:    [QuoteStatus.Sent, QuoteStatus.Rejected],
  [QuoteStatus.Sent]:     [QuoteStatus.Viewed, QuoteStatus.Accepted, QuoteStatus.Rejected, QuoteStatus.Expired],
  [QuoteStatus.Viewed]:   [QuoteStatus.Accepted, QuoteStatus.Rejected, QuoteStatus.Expired],
  [QuoteStatus.Accepted]: [],  // Terminal — booking conversion handled externally
  [QuoteStatus.Rejected]: [],  // Terminal
  [QuoteStatus.Expired]:  [],  // Terminal — set by cron
};

function validateTransition(current: QuoteStatus, next: QuoteStatus) {
  if (!VALID_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid quote status transition: ${current} → ${next}`);
  }
}

// ─── Sequence Generator ───────────────────────────────────────────────────────

async function generateQuoteId(): Promise<{ id: string; seq: number }> {
  const seq = await prisma.quoteSequence.upsert({
    where:  { id: 1 },
    update: { value: { increment: 1 } },
    create: { id: 1, value: 1 },
  });

  const mm  = new Date().getMonth() + 1;
  const yy  = new Date().getFullYear().toString().substring(2);
  const mon = mm < 10 ? `0${mm}` : `${mm}`;
  const seq3 = seq.value.toString().padStart(3, '0');

  return { id: `QT-${yy}${mon}-${seq3}`, seq: seq.value };
}

// ─── Pricing Calculator ───────────────────────────────────────────────────────

function computeTotals(items: LineItemInput[], discount_amount: number = 0) {
  let subtotal = 0;
  let taxTotal = 0;

  const computed = items.map(item => {
    const lineBase = item.unit_price * item.quantity;
    const lineTax  = lineBase * ((item.tax_percent ?? 18) / 100);
    const lineTotal = lineBase + lineTax;
    subtotal += lineBase;
    taxTotal += lineTax;
    return { ...item, total_price: parseFloat(lineTotal.toFixed(2)) };
  });

  if (discount_amount < 0) {
    throw new Error('Discount amount cannot be negative');
  }
  if (discount_amount > subtotal) {
    throw new Error('Discount amount cannot exceed subtotal');
  }

  return {
    items: computed,
    subtotal:    parseFloat(subtotal.toFixed(2)),
    tax_amount:  parseFloat(taxTotal.toFixed(2)),
    discount_amount: parseFloat(discount_amount.toFixed(2)),
    total_amount: parseFloat((subtotal - discount_amount + taxTotal).toFixed(2)),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class QuoteService {

  /** Create a new Quote (status: Draft) */
  static async createQuote(input: CreateQuoteInput) {
    const generated = await generateQuoteId();
    const { items, subtotal, tax_amount, discount_amount, total_amount } = computeTotals(input.line_items, input.discount_amount);

    const quote = await prisma.quote.create({
      data: {
        quote_id:        generated.id,
        sequence_number: generated.seq,
        customer_id:     input.customer_id,
        lead_id:         input.lead_id,
        subject:         input.subject,
        description:     input.description,
        valid_until:     input.valid_until,
        notes:           input.notes,
        terms:           input.terms,
        status:          QuoteStatus.Draft,
        subtotal,
        tax_amount,
        discount_amount,
        total_amount,
        created_by: input.created_by,
        line_items: {
          create: items.map(i => ({
            service_id:  i.service_id,
            description: i.description,
            quantity:    i.quantity,
            unit_price:  i.unit_price,
            tax_percent: i.tax_percent ?? 18,
            total_price: i.total_price,
            sort_order:  i.sort_order ?? 0,
          })),
        },
        timeline: {
          create: {
            to_status:  QuoteStatus.Draft,
            note:       'Quote created.',
            changed_by: input.created_by,
          },
        },
      },
      include: { line_items: true },
    });

    eventBus.publish('Quote.Created', {
      quote_id:    quote.quote_id,
      customer_id: quote.customer_id,
      total:       total_amount,
    });

    return quote;
  }

  /** Update a Draft quote (subject, line items, etc.) */
  static async updateQuote(id: string, input: UpdateQuoteInput, changed_by: string) {
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id } });

    if (quote.status !== QuoteStatus.Draft) {
      throw new Error(`Only Draft quotes can be edited. Current status: ${quote.status}`);
    }

    const data: any = {
      subject:     input.subject,
      description: input.description,
      valid_until: input.valid_until,
      notes:       input.notes,
      terms:       input.terms,
    };

    if (input.discount_amount !== undefined) {
      data.discount_amount = input.discount_amount;
    }

    if (input.line_items || input.discount_amount !== undefined) {
      // If line items are not provided, we must fetch them from the database to recalculate totals correctly
      let itemsToCompute = input.line_items;
      if (!itemsToCompute) {
        const existingItems = await prisma.quoteLineItem.findMany({ where: { quote_id: id } });
        itemsToCompute = existingItems.map(i => ({
          service_id: i.service_id ?? undefined,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price.toNumber(),
          tax_percent: i.tax_percent.toNumber(),
          sort_order: i.sort_order
        }));
      }

      const { items, subtotal, tax_amount, discount_amount, total_amount } = computeTotals(itemsToCompute, input.discount_amount ?? quote.discount_amount.toNumber());
      data.subtotal     = subtotal;
      data.tax_amount   = tax_amount;
      data.discount_amount = discount_amount;
      data.total_amount = total_amount;

      if (input.line_items) {
        // Replace line items atomically only if they were provided
        data.line_items = {
          deleteMany: {},
          create: items.map(i => ({
            service_id:  i.service_id,
            description: i.description,
            quantity:    i.quantity,
            unit_price:  i.unit_price,
            tax_percent: i.tax_percent ?? 18,
            total_price: i.total_price,
            sort_order:  i.sort_order ?? 0,
          })),
        };
      }
    }

    return prisma.quote.update({
      where: { id },
      data,
      include: { line_items: true },
    });
  }

  /** Send quote to customer (Draft → Sent) */
  static async sendQuote(id: string, changed_by: string, note?: string) {
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id } });
    validateTransition(quote.status, QuoteStatus.Sent);

    const updated = await prisma.quote.update({
      where: { id },
      data: {
        status:  QuoteStatus.Sent,
        sent_at: new Date(),
        timeline: {
          create: {
            from_status: quote.status,
            to_status:   QuoteStatus.Sent,
            note:        note || 'Quote sent to customer.',
            changed_by,
          },
        },
      },
    });

    eventBus.publish('Quote.Sent', { quote_id: updated.quote_id, customer_id: updated.customer_id });

    // Additive: if quote is linked to a Lead, auto-advance to QuotationSent
    // Uses the existing ALLOWED_TRANSITIONS in lead.service.ts (Qualified → QuotationSent is valid)
    if (updated.lead_id) {
      try {
        const lead = await prisma.lead.findUnique({ where: { id: updated.lead_id }, select: { status: true } });
        if (lead && ['Contacted', 'FollowUp', 'Qualified'].includes(lead.status)) {
          await prisma.$transaction(async (tx) => {
            await tx.lead.update({ where: { id: updated.lead_id! }, data: { status: 'QuotationSent' } });
            await tx.leadHistory.create({
              data: { lead_id: updated.lead_id!, from_stage: lead.status as any, to_stage: 'QuotationSent', changed_by }
            });
          });
        }
      } catch (leadErr: any) {
        // Non-blocking: lead update failure must never fail the quote send operation
        console.error('[QuoteService] Failed to update lead status to QuotationSent:', leadErr.message);
      }
    }

    return updated;
  }

  /** Mark as Viewed (Sent → Viewed) — typically triggered by a customer link open */
  static async markViewed(id: string) {
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id } });
    if (quote.status !== QuoteStatus.Sent) return quote; // idempotent

    return prisma.quote.update({
      where: { id },
      data: {
        status:    QuoteStatus.Viewed,
        viewed_at: new Date(),
        timeline: {
          create: {
            from_status: quote.status,
            to_status:   QuoteStatus.Viewed,
            note:        'Quote viewed by customer.',
            changed_by:  'system',
          },
        },
      },
    });
  }

  /**
   * Accept a quote (Sent/Viewed → Accepted).
   *
   * BOOKING CONVERSION IS NOT IMPLEMENTED HERE.
   * The Quote.Accepted event is published for Phase 9 Automation to handle,
   * once the client decides between Option A (auto-create) and Option B (manual).
   */
  static async acceptQuote(id: string, changed_by: string, note?: string) {
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id } });
    validateTransition(quote.status, QuoteStatus.Accepted);

    const updated = await prisma.quote.update({
      where: { id },
      data: {
        status:      QuoteStatus.Accepted,
        accepted_at: new Date(),
        timeline: {
          create: {
            from_status: quote.status,
            to_status:   QuoteStatus.Accepted,
            note:        note || 'Quote accepted by customer.',
            changed_by,
          },
        },
      },
    });

    // Publish for automation — booking conversion is handled downstream
    eventBus.publish('Quote.Accepted', {
      quote_id:    updated.quote_id,
      customer_id: updated.customer_id,
      lead_id:     updated.lead_id,
      total:       Number(updated.total_amount),
      // PENDING: booking_conversion_mode will be added when client decides
    });

    return updated;
  }

  /** Reject a quote */
  static async rejectQuote(id: string, reason: string, changed_by: string) {
    const quote = await prisma.quote.findUniqueOrThrow({ where: { id } });
    validateTransition(quote.status, QuoteStatus.Rejected);

    const updated = await prisma.quote.update({
      where: { id },
      data: {
        status:      QuoteStatus.Rejected,
        rejected_at: new Date(),
        timeline: {
          create: {
            from_status: quote.status,
            to_status:   QuoteStatus.Rejected,
            note:        reason,
            changed_by,
          },
        },
      },
    });

    eventBus.publish('Quote.Rejected', {
      quote_id:    updated.quote_id,
      customer_id: updated.customer_id,
      reason,
    });

    return updated;
  }

  /** Get quote with full details */
  static async getQuoteDetails(id: string) {
    return prisma.quote.findUniqueOrThrow({
      where:   { id },
      include: {
        line_items: { orderBy: { sort_order: 'asc' } },
        timeline:   { orderBy: { changed_at: 'asc' } },
        customer:   { select: { id: true, name: true, phone: true } },
      },
    });
  }

  /** List quotes with RBAC filtering applied by caller */
  static async listQuotes(where: object) {
    return prisma.quote.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        _count:   { select: { line_items: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
