import { Router } from 'express';
import * as reportController from '../../controllers/report.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';

const router = Router();

const REPORT_ROLES = ['Super Admin', 'Finance', 'City Manager'];
const OPERATIONAL_ROLES = ['Super Admin', 'Finance', 'City Manager', 'Support Agent'];

router.use(protect);

// Domain-split reports
router.get('/dashboard', authorize(...OPERATIONAL_ROLES), reportController.getDashboardKPIs);
router.get('/financial', authorize(...REPORT_ROLES), reportController.getFinancialReport);
router.get('/operational', authorize(...OPERATIONAL_ROLES), reportController.getOperationalReport);
router.get('/technician', authorize(...OPERATIONAL_ROLES), reportController.getTechnicianReport);
router.get('/gst', authorize(...REPORT_ROLES), reportController.getGSTReport);

export default router;
