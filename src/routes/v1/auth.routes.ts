import { Router } from 'express';
import { login } from '../../controllers/auth.controller';
import { validateRequest } from '../../middlewares/validate.middleware';
import { loginSchema } from '../../validations/auth.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.post('/login', validateRequest(loginSchema), catchAsync(login));
export default router;
