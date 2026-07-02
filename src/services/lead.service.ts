import { PrismaClient, LeadStatus } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllLeads = async (cityId?: string) => {
  const where = cityId ? { city_id: cityId } : {};
  return prisma.lead.findMany({
    where,
    include: { city: true, service: true, assignedTo: true, notes: true, history: true }
  });
};

export const createLead = async (data: any) => {
  return prisma.lead.create({ data });
};

export const updateLead = async (id: string, data: any) => {
  return prisma.lead.update({
    where: { id },
    data
  });
};

export const createLeadNote = async (lead_id: string, note_text: string, created_by: string) => {
  return prisma.leadNote.create({
    data: { lead_id, note_text, created_by }
  });
};

export const createLeadHistory = async (lead_id: string, from_stage: LeadStatus | null, to_stage: LeadStatus, changed_by: string) => {
  return prisma.leadHistory.create({
    data: { lead_id, from_stage, to_stage, changed_by }
  });
};
