import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';
const prisma = new PrismaClient();
const ALLOWED_TRANSITIONS = {
    New: ['Contacted', 'Qualified', 'Lost'],
    Contacted: ['FollowUp', 'Qualified', 'QuotationSent', 'Lost'],
    FollowUp: ['Contacted', 'Qualified', 'QuotationSent', 'Lost'],
    Qualified: ['QuotationSent', 'Booked', 'Lost'],
    QuotationSent: ['FollowUp', 'Booked', 'Lost'],
    Booked: ['Lost'],
    Lost: ['New', 'Contacted']
};
export const getAllLeads = async (cityId) => {
    const where = cityId ? { city_id: cityId } : {};
    return prisma.lead.findMany({
        where,
        include: { city: true, service: true, assignedTo: true, notes: true, history: true }
    });
};
export const getLeadById = async (id, cityId) => {
    const where = { id };
    if (cityId)
        where.city_id = cityId;
    const lead = await prisma.lead.findFirst({
        where,
        include: { city: true, service: true, assignedTo: true, notes: { include: { createdBy: true } }, history: { include: { changedBy: true } }, customer: true }
    });
    if (!lead)
        throw new AppError('Lead not found', 404);
    return lead;
};
export const createLead = async (data, created_by) => {
    return prisma.$transaction(async (tx) => {
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
    });
};
export const updateLead = async (id, data, changed_by) => {
    const currentLead = await prisma.lead.findUnique({ where: { id } });
    if (!currentLead)
        throw new AppError('Lead not found', 404);
    // Validate status transition
    if (data.status && data.status !== currentLead.status) {
        const allowed = ALLOWED_TRANSITIONS[currentLead.status];
        if (!allowed.includes(data.status)) {
            throw new AppError(`Invalid transition from ${currentLead.status} to ${data.status}`, 400);
        }
        if (data.status === 'Lost' && !data.lost_reason_id) {
            throw new AppError('Lost reason is required when marking lead as Lost', 400);
        }
        // If not lost, ensure we don't save a lost_reason_id
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
    return prisma.$transaction(async (tx) => {
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
        // Optional: Log assignment as history? Product spec usually separates history. We log stage transitions above.
        return updated;
    });
};
export const createLeadNote = async (lead_id, note_text, created_by) => {
    return prisma.leadNote.create({
        data: { lead_id, note_text, created_by }
    });
};
