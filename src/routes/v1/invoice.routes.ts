import { Router } from 'express';
import * as invoiceController from '../../controllers/invoice.controller';
import { validateRequest } from '../../middlewares/validate.middleware';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { createInvoiceFromBookingSchema, updateInvoiceStatusSchema } from '../../validations/invoice.validation';

const router = Router();

router.use(protect);

// Invoices are generally accessible to Admin, City Manager, and Support Agent
// But creation/updates are limited to Admin and City Manager (or Finance)
router.get('/', authorize('Super Admin', 'City Manager', 'Support Agent'), invoiceController.getInvoices);
router.get('/:id', authorize('Super Admin', 'City Manager', 'Support Agent'), invoiceController.getInvoiceById);

// POST manually drafted from booking
router.post('/from-booking/:bookingId', 
  authorize('Super Admin', 'City Manager'),
  validateRequest(createInvoiceFromBookingSchema),
  invoiceController.createInvoiceFromBooking
);

// PATCH status (Issue, Cancel)
router.patch('/:id/status',
  authorize('Super Admin', 'City Manager'),
  validateRequest(updateInvoiceStatusSchema),
  invoiceController.updateInvoiceStatus
);

export default router;
