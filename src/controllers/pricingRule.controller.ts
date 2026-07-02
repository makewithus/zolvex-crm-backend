import { Request, Response } from 'express';
import * as pricingRuleService from '../services/pricingRule.service';
import { sendSuccess } from '../utils/response.util';

export const getPricingRules = async (req: Request, res: Response) => {
  const rules = await pricingRuleService.getAllPricingRules();
  sendSuccess(res, 200, 'Pricing Rules retrieved', rules);
};

export const createPricingRule = async (req: Request, res: Response) => {
  const rule = await pricingRuleService.createPricingRule(req.body);
  sendSuccess(res, 201, 'Pricing Rule created', rule);
};
