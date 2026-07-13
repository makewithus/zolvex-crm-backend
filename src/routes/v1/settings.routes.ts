import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';
import * as settingsController from '../../controllers/settings.controller';

const router = Router();
router.use(protect);

// Any authenticated user may read settings (company name, GST state, etc.)
router.get('/', catchAsync(settingsController.getSettings));

// Only Super Admin may change settings — this affects live GST calculations
router.patch('/:key', authorize('Super Admin'), catchAsync(settingsController.updateSetting));

export default router;
