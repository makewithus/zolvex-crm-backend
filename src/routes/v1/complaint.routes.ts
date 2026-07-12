import { Router } from 'express';
import { ComplaintController } from '../../controllers/complaint.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';

const router = Router();

// Only authenticated staff can access complaint routes
router.use(protect);

// Create: Admin or City Manager
router.post(
  '/',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  ComplaintController.createComplaint
);

// Read: All roles, but filtered by RBAC inside the controller
router.get('/', ComplaintController.getComplaints);
router.get('/:id', ComplaintController.getComplaintById);

// Update/Workflow: Roles restricted as needed
router.post(
  '/:id/assign',
  authorize('Super Admin', 'City Manager'),
  ComplaintController.assignComplaint
);

router.post(
  '/:id/start',
  authorize('Super Admin', 'City Manager', 'Technician', 'Support Agent'),
  ComplaintController.startComplaint
);

router.post(
  '/:id/resolve',
  authorize('Super Admin', 'City Manager', 'Technician', 'Support Agent'),
  ComplaintController.resolveComplaint
);

router.post(
  '/:id/escalate',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  ComplaintController.escalateComplaint
);

router.post(
  '/:id/close',
  authorize('Super Admin'), // Only Super Admin can fully close a resolved complaint
  ComplaintController.closeComplaint
);

export default router;
