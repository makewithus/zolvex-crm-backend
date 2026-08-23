import { Request, Response } from 'express';
import * as alertService from '../services/alert.service';
import { sendSuccess } from '../utils/response.util';

export const getAlertsSummary = async (req: Request, res: Response) => {
  const summary = await alertService.getAlertsSummary();
  sendSuccess(res, 200, 'Alerts summary retrieved', summary);
};
