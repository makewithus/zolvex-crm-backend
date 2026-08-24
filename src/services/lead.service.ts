import { PrismaClient, LeadStatus, Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { eventBus } from '../events/eventBus';

const prisma = new PrismaClient();

const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  New: ['Contacted', 'Qualified', 'Lost'],
  Contacted: ['FollowUp', 'Qualified', 'QuotationSent', 'Lost'],
  FollowUp: ['Contacted', 'Qualified', 'QuotationSent', 'Lost'],
  Qualified: ['QuotationSent', 'Booked', 'Lost'],
  QuotationSent: ['FollowUp', 'Booked', 'Lost'],
  Booked: ['Lost'],
  Lost: ['New', 'Contacted']
};

export const getAllLeads = async (cityId?: string) => {
  const where = cityId ? { city_id: cityId } : {};
  return prisma.lead.findMany({
    where,
    orderBy: [
      { created_at: 'desc' },
      { id: 'desc' }
    ],
    include: { city: true, service: true, assignedTo: true, notes: true, history: true }
  });
};

export const getLeadById = async (id: string, cityId?: string) => {
  const where: any = { id };
  if (cityId) where.city_id = cityId;
  
  const lead = await prisma.lead.findFirst({
    where,
    include: { city: true, service: true, assignedTo: true, notes: { include: { createdBy: true } }, history: { include: { changedBy: true } }, customer: true }
  });
  
  if (!lead) throw new AppError('Lead not found', 404);
  return lead;
};

export const createLead = async (data: any, created_by: string) => {
  const lead = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // 1. Mandatory Customer deduplication and auto-creation
    const customer = await tx.customer.upsert({
      where: { phone: data.phone },
      update: {
        name: data.name || undefined,
      },
      create: {
        phone: data.phone,
        name: data.name,
      }
    });

    // 2. Attach Customer to Lead
    const leadData = { ...data, customer_id: customer.id };

    const lead = await tx.lead.create({ data: leadData });
    await tx.leadHistory.create({
      data: {
        lead_id: lead.id,
        to_stage: 'New',
        changed_by: created_by
      }
    });
    return lead;
  }, {
    maxWait: 5000,
    timeout: 10000
  });

  // Emit event for Sprint 9.3 Operations Automations
  eventBus.publish('Lead.Created', { lead_id: lead.id });

  return lead;
};

export const updateLead = async (id: string, data: any, changed_by: string) => {
  const currentLead = await prisma.lead.findUnique({ where: { id } });
  if (!currentLead) throw new AppError('Lead not found', 404);

  // Validate status transition
  if (data.status && data.status !== currentLead.status) {
    const allowed = ALLOWED_TRANSITIONS[currentLead.status as LeadStatus];
    if (!allowed.includes(data.status as LeadStatus)) {
      throw new AppError(`Invalid transition from ${currentLead.status} to ${data.status}`, 400);
    }
    if (data.status === 'Lost' && !data.lost_reason_id) {
      throw new AppError('A lost reason is required when marking a lead as Lost.', 400);
    }
    // If not lost, ensure we don't save a stale lost_reason_id
    if (data.status !== 'Lost') {
      data.lost_reason_id = null;
    }
  }

  // Validate assignment
  if (data.assigned_to && data.assigned_to !== currentLead.assigned_to) {
    const user = await prisma.user.findUnique({ where: { id: data.assigned_to } });
    if (!user || !user.is_active) {
      throw new AppError('Invalid or inactive user assigned', 400);
    }
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.lead.update({
      where: { id },
      data
    });

    if (data.status && data.status !== currentLead.status) {
      await tx.leadHistory.create({
        data: {
          lead_id: id,
          from_stage: currentLead.status,
          to_stage: data.status,
          changed_by
        }
      });
    }

    return updated;
  }, {
    maxWait: 5000,
    timeout: 10000
  });
};

export const createLeadNote = async (lead_id: string, note_text: string, created_by: string) => {
  const note = await prisma.leadNote.create({
    data: { lead_id, note_text, created_by }
  });

  // ── Stage Rule: Note added on a New lead → auto-advance to Contacted ────
  // Simple if-then only. Non-blocking — failure never affects note creation.
  try {
    await applyStageRulesAfterNote(lead_id, created_by);
  } catch {
    // Silently ignore — stage rule failure must never break note creation
  }

  return note;
};

/**
 * STAGE RULES (simple hardcoded if-then, no rule engine)
 * Rule 1: If lead is 'New' and a note is added → advance to 'Contacted'
 * Rules are ADDITIVE and NON-BLOCKING. Never gate any workflow.
 */
const applyStageRulesAfterNote = async (lead_id: string, changed_by: string): Promise<void> => {
  const lead = await prisma.lead.findUnique({ where: { id: lead_id }, select: { status: true } });
  if (!lead) return;

  if (lead.status === 'New') {
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead_id }, data: { status: 'Contacted' } });
      await tx.leadHistory.create({
        data: { lead_id, from_stage: 'New', to_stage: 'Contacted', changed_by }
      });
    }, {
      maxWait: 5000,
      timeout: 10000
    });
  }
};
