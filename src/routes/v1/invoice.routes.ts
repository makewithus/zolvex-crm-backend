import { Router } from 'express';
import * as invoiceController from '../../controllers/invoice.controller';
import { validateRequest } from '../../middlewares/validate.middleware';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { createInvoiceFromBookingSchema, updateInvoiceStatusSchema } from '../../validations/invoice.validation';

const router = Router();

router.use(protect);

// Invoices: Finance can VIEW all; creation/mutations are Admin/City Manager only
router.get('/', authorize('Super Admin', 'City Manager', 'Support Agent', 'Finance'), invoiceController.getInvoices);
router.get('/:id', authorize('Super Admin', 'City Manager', 'Support Agent', 'Finance'), invoiceController.getInvoiceById);
router.get('/:id/pdf', authorize('Super Admin', 'City Manager', 'Support Agent', 'Finance'), invoiceController.generatePdf);

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
