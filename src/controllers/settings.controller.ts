import { Request, Response } from 'express';
import * as settingsService from '../services/settings.service';
import { invalidateCompanyStateCache, SETTING_KEYS } from '../services/settings.service';
import { sendSuccess } from '../utils/response.util';

export const getSettings = async (req: Request, res: Response) => {
  const settings = await settingsService.getAllSettings();
  sendSuccess(res, 200, 'Settings retrieved', settings);
};

export const updateSetting = async (req: Request, res: Response) => {
  const key    = String(req.params.key);
  const value  = String(req.body.value ?? '');
  const label  = req.body.label ? String(req.body.label) : undefined;
  const userId = (req as any).user?.id as string;

  await settingsService.upsertSetting(key, value, label, userId);

  // Immediately invalidate cached state if the registered state changed
  if (key === SETTING_KEYS.COMPANY_REGISTERED_STATE) {
    invalidateCompanyStateCache();
  }

  sendSuccess(res, 200, 'Setting updated', { key, value });
};
