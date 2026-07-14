import { Router } from 'express';
import { getLostReasons, createLostReason } from '../../controllers/lostReason.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { createLostReasonSchema } from '../../validations/lostReason.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.get('/', catchAsync(getLostReasons));
router.post('/', validateRequest(createLostReasonSchema), catchAsync(createLostReason));

export default router;
