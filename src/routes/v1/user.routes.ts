import { Router } from 'express';
import { getUsers, createUser } from '../../controllers/user.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.use(authorize('Super Admin', 'City Manager'));
router.get('/', catchAsync(getUsers));
router.post('/', catchAsync(createUser));
export default router;
