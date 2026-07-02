import { Router } from 'express';
import { getCities, createCity, updateCity } from '../../controllers/city.controller';
import { protect } from '../../middlewares/auth.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { updateCitySchema } from '../../validations/city.validation';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.get('/', catchAsync(getCities));
router.post('/', authorize('Super Admin'), catchAsync(createCity));
router.patch('/:id', authorize('Super Admin'), validateRequest(updateCitySchema), catchAsync(updateCity));
export default router;
