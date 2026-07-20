import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';
import * as ctrl from '../../controllers/checklist.controller';

const router = Router();
router.use(protect);

const adminRoles = ['Super Admin', 'City Manager'];
const fieldRoles = ['Super Admin', 'City Manager', 'Support Agent', 'Field Staff', 'Technician'];

// Template management (admin only)
router.get('/',        authorize(...adminRoles), catchAsync(ctrl.getTemplates));
router.get('/:id',     authorize(...adminRoles), catchAsync(ctrl.getTemplateById));
router.post('/',       authorize(...adminRoles), catchAsync(ctrl.createTemplate));
router.patch('/:id',   authorize(...adminRoles), catchAsync(ctrl.updateTemplate));
router.delete('/:id',  authorize(...adminRoles), catchAsync(ctrl.deleteTemplate));

export default router;
