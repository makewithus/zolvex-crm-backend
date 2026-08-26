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
// Exports
router.get('/export/financial', authorize(...REPORT_ROLES), reportController.exportFinancialReport);
router.get('/export/operational', authorize(...OPERATIONAL_ROLES), reportController.exportOperationalReport);
router.get('/export/technician', authorize(...OPERATIONAL_ROLES), reportController.exportTechnicianReport);
router.get('/export/gst', authorize(...REPORT_ROLES), reportController.exportGSTReport);

// Finance Overview — new additive endpoint (Finance + Super Admin only)
router.get('/finance-summary', authorize(...REPORT_ROLES), reportController.getFinanceSummary);
router.get('/export/finance-summary', authorize(...REPORT_ROLES), reportController.exportFinanceSummary);

export default router;
