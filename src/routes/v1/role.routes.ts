import { Router } from 'express';
import { getRoles } from '../../controllers/role.controller';
import { protect } from '../../middlewares/auth.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.get('/', protect, catchAsync(getRoles));
export default router;
