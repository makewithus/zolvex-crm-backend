import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import {
  getThreads,
  getMessages,
  sendMessage,
  assignThread,
  resolveThread
} from '../../controllers/whatsappInbox.controller';

const router = Router();

// All inbox routes require authentication
router.use(protect);

// Roles: SuperAdmin, CityManager, Support only. Technicians and Finance excluded.
const INBOX_ROLES = ['Super Admin', 'City Manager', 'Support Agent'];

router.get('/threads', authorize(...INBOX_ROLES), getThreads);
router.get('/threads/:id/messages', authorize(...INBOX_ROLES), getMessages);
router.post('/threads/:id/send', authorize(...INBOX_ROLES), sendMessage);
router.patch('/threads/:id/assign', authorize(...INBOX_ROLES), assignThread);
router.patch('/threads/:id/resolve', authorize(...INBOX_ROLES), resolveThread);

export default router;
