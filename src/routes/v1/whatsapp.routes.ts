import { Router } from 'express';
import { verifyWebhook, receiveWebhook } from '../../controllers/whatsapp.controller';

const router = Router();

// Public webhook endpoints for Meta WhatsApp Cloud API
router.get('/', verifyWebhook);
router.post('/', receiveWebhook);

export default router;
