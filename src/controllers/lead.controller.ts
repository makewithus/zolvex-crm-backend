import { Request, Response } from 'express';
import * as leadService from '../services/lead.service';
import { sendSuccess } from '../utils/response.util';

export const getLeads = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const cityId = user.role === 'City Manager' ? user.cityId : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const leads = await leadService.getAllLeads(cityId, limit);
  sendSuccess(res, 200, 'Leads retrieved', leads);
};

export const getLeadById = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const cityId = user.role === 'City Manager' ? user.cityId : undefined;
  const lead = await leadService.getLeadById(req.params.id as string, cityId);
  sendSuccess(res, 200, 'Lead retrieved', lead);
};

export const createLead = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const lead = await leadService.createLead(req.body, user.id);
  sendSuccess(res, 201, 'Lead created', lead);
};

export const updateLead = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const lead = await leadService.updateLead(req.params.id as string, req.body, user.id);
  sendSuccess(res, 200, 'Lead updated', lead);
};

export const addLeadNote = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { note_text } = req.body;
  const note = await leadService.createLeadNote(id as string, note_text, user.id);
  sendSuccess(res, 201, 'Lead note added', note);
};
