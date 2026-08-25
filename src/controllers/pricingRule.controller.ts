import { Request, Response } from 'express';
import * as pricingRuleService from '../services/pricingRule.service';
import { sendSuccess } from '../utils/response.util';

export const getPricingRules = async (req: Request, res: Response) => {
  const rules = await pricingRuleService.getAllPricingRules(req.query);
  sendSuccess(res, 200, 'Pricing Rules retrieved', rules);
};

export const createPricingRule = async (req: Request, res: Response) => {
  const rule = await pricingRuleService.createPricingRule(req.body);
  sendSuccess(res, 201, 'Pricing rule created', rule);
};

export const updatePricingRule = async (req: Request, res: Response) => {
  const rule = await pricingRuleService.updatePricingRule(req.params.id as string, req.body);
  sendSuccess(res, 200, 'Pricing rule updated', rule);
};

export const deletePricingRule = async (req: Request, res: Response) => {
  await pricingRuleService.deletePricingRule(req.params.id as string);
  res.status(204).send();
};
