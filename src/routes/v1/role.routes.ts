import { Router } from 'express';
import { getRoles } from '../../controllers/role.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.get('/', protect, authorize('Super Admin'), catchAsync(getRoles));
export default router;
