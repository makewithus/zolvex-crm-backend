import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';
import * as ctrl from '../../controllers/feedback.controller';

const router = Router();
router.use(protect);

const allRoles = ['Super Admin', 'City Manager', 'Support Agent', 'Field Staff', 'Technician', 'Finance'];
const canWrite  = ['Super Admin', 'City Manager', 'Support Agent', 'Field Staff', 'Technician'];
const canDelete = ['Super Admin', 'City Manager'];

router.get('/stats',  authorize('Super Admin', 'City Manager', 'Finance'), catchAsync(ctrl.getFeedbackStats));
router.get('/',       authorize(...allRoles), catchAsync(ctrl.getFeedbacks));
router.get('/:id',    authorize(...allRoles), catchAsync(ctrl.getFeedbackById));
router.post('/',      authorize(...canWrite), catchAsync(ctrl.createFeedback));
router.put('/:id',    authorize(...canWrite), catchAsync(ctrl.updateFeedback));
router.delete('/:id', authorize(...canDelete), catchAsync(ctrl.deleteFeedback));

export default router;

