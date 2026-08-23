import { Router } from 'express';
import { getAlertsSummary } from '../../controllers/alert.controller';
import { protect } from '../../middlewares/auth.middleware';

const router = Router();

router.use(protect);

router.get('/summary', getAlertsSummary);

export default router;
