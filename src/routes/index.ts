import { Router } from 'express';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'success', message: 'ZOLVEX CRM API is running' });
});

export default router;
