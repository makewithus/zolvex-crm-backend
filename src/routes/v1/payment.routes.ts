import { Router } from 'express';
import * as paymentController from '../../controllers/payment.controller';
import { validateRequest } from '../../middlewares/validate.middleware';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { createPaymentSchema, getPaymentsSchema } from '../../validations/payment.validation';

const router = Router();

// Protect all routes
router.use(protect);

// Roles allowed to interact with any payment endpoint
const PAYMENT_ROLES = ['Super Admin', 'Finance', 'City Manager'] as const;

// Only authorised roles can record payments
router.post(
  '/',
  authorize(...PAYMENT_ROLES),
  validateRequest(createPaymentSchema),
  paymentController.recordPayment
);

// Only authorised roles can view payments
router.get(
  '/',
  authorize(...PAYMENT_ROLES),
  validateRequest(getPaymentsSchema),
  paymentController.getPayments
);

router.get('/:id', authorize(...PAYMENT_ROLES), paymentController.getPaymentById);
router.get('/:id/pdf', authorize(...PAYMENT_ROLES), paymentController.downloadReceipt);

export default router;
