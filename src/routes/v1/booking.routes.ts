import { Router } from 'express';
import { 
  getBookings, 
  getBookingById, 
  createBooking, 
  convertLeadToBooking, 
  updateBooking, 
  updateBookingStatus, 
  rescheduleBooking, 
  cancelBooking 
} from '../../controllers/booking.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { 
  getBookingsSchema, 
  createBookingSchema, 
  updateBookingSchema, 
  updateBookingStatusSchema, 
  rescheduleBookingSchema, 
  cancelBookingSchema, 
  convertLeadToBookingSchema 
} from '../../validations/booking.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);

const adminCitySupport = ['Super Admin', 'City Manager', 'Support Agent'];
const allRoles = ['Super Admin', 'City Manager', 'Support Agent', 'Finance', 'Field Staff'];

router.get('/', authorize(...allRoles), validateRequest(getBookingsSchema), catchAsync(getBookings));
router.get('/:id', authorize(...allRoles), catchAsync(getBookingById));

router.post('/', authorize(...adminCitySupport), validateRequest(createBookingSchema), catchAsync(createBooking));
router.post('/convert-lead/:leadId', authorize(...adminCitySupport), validateRequest(convertLeadToBookingSchema), catchAsync(convertLeadToBooking));

router.patch('/:id', authorize(...adminCitySupport), validateRequest(updateBookingSchema), catchAsync(updateBooking));
router.patch('/:id/status', authorize(...adminCitySupport), validateRequest(updateBookingStatusSchema), catchAsync(updateBookingStatus));
router.patch('/:id/reschedule', authorize(...adminCitySupport), validateRequest(rescheduleBookingSchema), catchAsync(rescheduleBooking));
router.patch('/:id/cancel', authorize(...adminCitySupport), validateRequest(cancelBookingSchema), catchAsync(cancelBooking));

export default router;
