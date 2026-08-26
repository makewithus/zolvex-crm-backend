import { Request, Response } from 'express';
import * as alertService from '../services/alert.service';
import { sendSuccess } from '../utils/response.util';

export const getAlertsSummary = async (req: any, res: Response) => {
  const summary = await alertService.getAlertsSummary(req.user);
  sendSuccess(res, 200, 'Alerts summary retrieved', summary);
};
