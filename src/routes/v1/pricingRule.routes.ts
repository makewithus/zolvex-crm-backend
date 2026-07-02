import { Router } from 'express';
import { getPricingRules, createPricingRule, updatePricingRule, deletePricingRule } from '../../controllers/pricingRule.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { createPricingRuleSchema, updatePricingRuleSchema, deletePricingRuleSchema } from '../../validations/pricingRule.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.get('/', catchAsync(getPricingRules));
router.post('/', authorize('Super Admin'), validateRequest(createPricingRuleSchema), catchAsync(createPricingRule));
router.patch('/:id', authorize('Super Admin'), validateRequest(updatePricingRuleSchema), catchAsync(updatePricingRule));
router.delete('/:id', authorize('Super Admin'), validateRequest(deletePricingRuleSchema), catchAsync(deletePricingRule));
export default router;
