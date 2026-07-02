import { Router } from 'express';
import { getCities, createCity } from '../../controllers/city.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.get('/', catchAsync(getCities));
router.post('/', authorize('Super Admin'), catchAsync(createCity));
export default router;
