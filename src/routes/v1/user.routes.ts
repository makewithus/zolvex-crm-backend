import { Router } from 'express';
import { getUsers, createUser, updateUser, resetPassword } from '../../controllers/user.controller';
import { protect } from '../../middlewares/auth.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { updateUserSchema, resetPasswordSchema } from '../../validations/user.validation';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.use(authorize('Super Admin', 'City Manager'));
router.get('/', catchAsync(getUsers));
router.post('/', catchAsync(createUser));
router.patch('/:id', validateRequest(updateUserSchema), catchAsync(updateUser));
router.patch('/:id/reset-password', validateRequest(resetPasswordSchema), catchAsync(resetPassword));
export default router;
