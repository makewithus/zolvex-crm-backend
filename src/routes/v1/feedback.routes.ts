import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';
import * as ctrl from '../../controllers/feedback.controller';

const router = Router();
router.use(protect);

const allRoles = ['Super Admin', 'City Manager', 'Support Agent', 'Field Staff', 'Technician', 'Finance'];

router.get('/stats',  authorize('Super Admin', 'City Manager', 'Finance'), catchAsync(ctrl.getFeedbackStats));
router.get('/',       authorize(...allRoles), catchAsync(ctrl.getFeedbacks));
router.get('/:id',    authorize(...allRoles), catchAsync(ctrl.getFeedbackById));
router.post('/',      authorize('Super Admin', 'City Manager', 'Support Agent', 'Field Staff', 'Technician'), catchAsync(ctrl.createFeedback));

export default router;
