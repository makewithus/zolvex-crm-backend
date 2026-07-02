import { Router } from 'express';
import authRoutes from './auth.routes';
import cityRoutes from './city.routes';
import userRoutes from './user.routes';
import roleRoutes from './role.routes';
import serviceRoutes from './service.routes';
import pricingRuleRoutes from './pricingRule.routes';
import leadRoutes from './lead.routes';
import lostReasonRoutes from './lostReason.routes';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'success', message: 'ZOLVEX CRM API v1 is running' });
});

router.use('/auth', authRoutes);
router.use('/cities', cityRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/services', serviceRoutes);
router.use('/pricing-rules', pricingRuleRoutes);
router.use('/leads', leadRoutes);
router.use('/lost-reasons', lostReasonRoutes);

export default router;
