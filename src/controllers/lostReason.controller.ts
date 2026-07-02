import { Request, Response } from 'express';
import * as lostReasonService from '../services/lostReason.service';
import { sendSuccess } from '../utils/response.util';

export const getLostReasons = async (req: Request, res: Response) => {
  const reasons = await lostReasonService.getAllLostReasons();
  sendSuccess(res, 200, 'Lost reasons retrieved', reasons);
};

export const createLostReason = async (req: Request, res: Response) => {
  const reason = await lostReasonService.createLostReason(req.body);
  sendSuccess(res, 201, 'Lost reason created', reason);
};
