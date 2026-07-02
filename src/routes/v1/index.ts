import { Router } from 'express';
import authRoutes from './auth.routes';
import cityRoutes from './city.routes';
import userRoutes from './user.routes';
import roleRoutes from './role.routes';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'success', message: 'ZOLVEX CRM API v1 is running' });
});

router.use('/auth', authRoutes);
router.use('/cities', cityRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);

export default router;
