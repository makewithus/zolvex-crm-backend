import { Request, Response, NextFunction } from 'express';
import * as checklistService from '../services/checklist.service';

export const getTemplates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const data = await checklistService.getChecklistTemplates(includeInactive);
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const getTemplateById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await checklistService.getChecklistTemplateById(req.params.id as string);
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const createTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, service_id, items = [] } = req.body;
    const data = await checklistService.createChecklistTemplate(
      { name, description, service_id },
      items,
      (req as any).user.id as string
    );
    res.status(201).json({ success: true, data });
  } catch (e) { next(e); }
};

export const updateTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, service_id, is_active, items } = req.body;
    const data = await checklistService.updateChecklistTemplate(
      req.params.id as string,
      { name, description, service_id, is_active },
      items
    );
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const deleteTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checklistService.deleteChecklistTemplate(req.params.id as string);
    res.json({ success: true, message: 'Template deactivated' });
  } catch (e) { next(e); }
};

// ── Job Checklist Endpoints ─────────────────────────────────────────────────

export const getJobChecklists = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await checklistService.getJobChecklists(req.params.jobId as string);
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const applyChecklist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await checklistService.applyChecklistToJob(
      req.params.jobId as string,
      req.body.template_id as string,
      (req as any).user.id as string
    );
    res.status(201).json({ success: true, data });
  } catch (e) { next(e); }
};

export const updateChecklistItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await checklistService.updateChecklistItem(
      req.params.itemId as string,
      req.body,
      (req as any).user.id as string
    );
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const removeChecklist = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checklistService.removeChecklistFromJob(req.params.checklistId as string);
    res.json({ success: true, message: 'Checklist removed' });
  } catch (e) { next(e); }
};
