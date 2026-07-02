import { Request, Response } from 'express';
import * as leadService from '../services/lead.service';
import { sendSuccess } from '../utils/response.util';

export const getLeads = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const cityId = user.role === 'City Manager' ? user.cityId : undefined;
  const leads = await leadService.getAllLeads(cityId);
  sendSuccess(res, 200, 'Leads retrieved', leads);
};

export const createLead = async (req: Request, res: Response) => {
  const lead = await leadService.createLead(req.body);
  sendSuccess(res, 201, 'Lead created', lead);
};

export const updateLead = async (req: Request, res: Response) => {
  const lead = await leadService.updateLead(req.params.id as string, req.body);
  sendSuccess(res, 200, 'Lead updated', lead);
};

export const addLeadNote = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { id } = req.params;
  const { note_text } = req.body;
  const note = await leadService.createLeadNote(id as string, note_text, user.id);
  sendSuccess(res, 201, 'Lead note added', note);
};
