import { Router } from 'express';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'success', message: 'ZOLVEX CRM API v1 is running' });
});

export default router;
