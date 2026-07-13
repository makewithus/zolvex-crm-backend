import { Router } from 'express';
import { getCustomers, getCustomerById, updateCustomer } from '../../controllers/customer.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { updateCustomerSchema } from '../../validations/customer.validation';
import { getCustomerInvoices } from '../../controllers/invoice.controller';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);

const customerRoles = ['Super Admin', 'City Manager', 'Support Agent', 'Finance', 'Field Staff', 'Technician'];

router.get('/', authorize(...customerRoles), catchAsync(getCustomers));
router.get('/:id', authorize(...customerRoles), catchAsync(getCustomerById));
router.get('/:id/invoices', authorize(...customerRoles), catchAsync(getCustomerInvoices as any));
router.patch('/:id', authorize(...customerRoles), validateRequest(updateCustomerSchema), catchAsync(updateCustomer));

export default router;
