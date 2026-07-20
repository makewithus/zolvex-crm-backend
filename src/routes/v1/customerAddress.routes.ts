import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';
import * as ctrl from '../../controllers/customerAddress.controller';

const router = Router({ mergeParams: true }); // mergeParams for :customerId
router.use(protect);

const roles = ['Super Admin', 'City Manager', 'Support Agent', 'Finance', 'Field Staff'];

router.get('/',          authorize(...roles), catchAsync(ctrl.getAddresses));
router.post('/',         authorize(...roles), catchAsync(ctrl.createAddress));
router.patch('/:addressId', authorize(...roles), catchAsync(ctrl.updateAddress));
router.delete('/:addressId', authorize(...roles), catchAsync(ctrl.deleteAddress));

export default router;
