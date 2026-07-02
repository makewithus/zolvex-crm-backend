import { Router } from 'express';
import { getServices, createService } from '../../controllers/service.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { createServiceSchema } from '../../validations/service.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.get('/', catchAsync(getServices));
router.post('/', authorize('Super Admin'), validateRequest(createServiceSchema), catchAsync(createService));
export default router;
