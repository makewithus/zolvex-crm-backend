import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

// ── Checklist Template Management ──────────────────────────────────────────

export const getChecklistTemplates = async (includeInactive = false) => {
  return prisma.checklistTemplate.findMany({
    where: includeInactive ? undefined : { is_active: true },
    include: { items: { orderBy: { sort_order: 'asc' } } },
    orderBy: { created_at: 'desc' }
  });
};

export const getChecklistTemplateById = async (id: string) => {
  const template = await prisma.checklistTemplate.findUnique({
    where: { id },
    include: { items: { orderBy: { sort_order: 'asc' } } }
  });
  if (!template) throw new AppError('Checklist template not found', 404);
  return template;
};

export const createChecklistTemplate = async (
  data: { name: string; description?: string; service_id?: string },
  items: { label: string; sort_order?: number; is_required?: boolean }[],
  created_by: string
) => {
  return prisma.checklistTemplate.create({
    data: {
      ...data,
      created_by,
      items: {
        create: items.map((item, idx) => ({
          label: item.label,
          sort_order: item.sort_order ?? idx,
          is_required: item.is_required ?? false
        }))
      }
    },
    include: { items: true }
  });
};

export const updateChecklistTemplate = async (
  id: string,
  data: { name?: string; description?: string; service_id?: string; is_active?: boolean },
  items?: { label: string; sort_order?: number; is_required?: boolean }[]
) => {
  const existing = await prisma.checklistTemplate.findUnique({ where: { id } });
  if (!existing) throw new AppError('Checklist template not found', 404);

  // If items provided — replace all items (simple upsert strategy)
  if (items) {
    await prisma.checklistTemplateItem.deleteMany({ where: { template_id: id } });
  }

  return prisma.checklistTemplate.update({
    where: { id },
    data: {
      ...data,
      ...(items && {
        items: {
          create: items.map((item, idx) => ({
            label: item.label,
            sort_order: item.sort_order ?? idx,
            is_required: item.is_required ?? false
          }))
        }
      })
    },
    include: { items: { orderBy: { sort_order: 'asc' } } }
  });
};

export const deleteChecklistTemplate = async (id: string) => {
  const existing = await prisma.checklistTemplate.findUnique({ where: { id } });
  if (!existing) throw new AppError('Checklist template not found', 404);
  // Soft-delete: mark inactive rather than hard-delete (preserves history)
  return prisma.checklistTemplate.update({
    where: { id },
    data: { is_active: false }
  });
};

// ── Job Checklist Instance Management ──────────────────────────────────────

/**
 * Apply a checklist template to a job.
 * Creates a JobChecklist + copies all template items as JobChecklistItems.
 * NEVER blocks job completion — informational only.
 */
export const applyChecklistToJob = async (job_id: string, template_id: string, applied_by: string) => {
  const template = await prisma.checklistTemplate.findUnique({
    where: { id: template_id },
    include: { items: { orderBy: { sort_order: 'asc' } } }
  });
  if (!template) throw new AppError('Checklist template not found', 404);

  // Check if already applied (idempotent)
  const existing = await prisma.jobChecklist.findFirst({ where: { job_id, template_id } });
  if (existing) throw new AppError('This checklist template is already applied to this job', 409);

  return prisma.jobChecklist.create({
    data: {
      job_id,
      template_id,
      applied_by,
      items: {
        create: template.items.map(item => ({
          label: item.label,
          sort_order: item.sort_order,
          is_required: item.is_required
        }))
      }
    },
    include: { items: { orderBy: { sort_order: 'asc' } }, template: true }
  });
};

export const getJobChecklists = async (job_id: string) => {
  return prisma.jobChecklist.findMany({
    where: { job_id },
    include: {
      template: { select: { id: true, name: true } },
      items: { orderBy: { sort_order: 'asc' } }
    }
  });
};

export const updateChecklistItem = async (
  item_id: string,
  data: { is_checked: boolean; notes?: string },
  user_id: string
) => {
  return prisma.jobChecklistItem.update({
    where: { id: item_id },
    data: {
      is_checked: data.is_checked,
      notes: data.notes,
      checked_by: data.is_checked ? user_id : null,
      checked_at: data.is_checked ? new Date() : null
    }
  });
};

export const removeChecklistFromJob = async (checklist_id: string) => {
  const existing = await prisma.jobChecklist.findUnique({ where: { id: checklist_id } });
  if (!existing) throw new AppError('Checklist not found on this job', 404);
  return prisma.jobChecklist.delete({ where: { id: checklist_id } });
};
