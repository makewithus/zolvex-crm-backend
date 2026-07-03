import { Router } from 'express';
import { login, getMe } from '../../controllers/auth.controller';
import { protect } from '../../middlewares/auth.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { loginSchema } from '../../validations/auth.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.post('/login', validateRequest(loginSchema), catchAsync(login));
router.get('/me', protect, catchAsync(getMe));
export default router;
