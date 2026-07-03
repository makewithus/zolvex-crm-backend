import { Router } from 'express';
import * as paymentController from '../../controllers/payment.controller';
import { validateRequest } from '../../middlewares/validate.middleware';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { createPaymentSchema, getPaymentsSchema } from '../../validations/payment.validation';

const router = Router();

// Protect all routes
router.use(protect);

// Only Super Admin, Finance, and City Manager can record payments
router.post(
  '/',
  authorize('Super Admin', 'Finance', 'City Manager'),
  validateRequest(createPaymentSchema),
  paymentController.recordPayment
);

// All authenticated users can view payments
router.get(
  '/',
  validateRequest(getPaymentsSchema),
  paymentController.getPayments
);

router.get('/:id', paymentController.getPaymentById);

export default router;
