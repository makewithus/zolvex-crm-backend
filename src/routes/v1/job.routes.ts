import { Router } from 'express';
import * as jobController from '../../controllers/job.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import * as jobValidation from '../../validations/job.validation';

const router = Router();

router.use(protect);

router.get('/', authorize('Super Admin', 'City Manager', 'Support Agent', 'Finance', 'Field Staff'), jobController.getJobs);
router.get('/:id', authorize('Super Admin', 'City Manager', 'Support Agent', 'Finance', 'Field Staff'), jobController.getJobById);

router.post('/from-booking/:bookingId', authorize('Super Admin', 'City Manager', 'Support Agent'), validateRequest(jobValidation.createJobFromBookingSchema), jobController.createJobFromBooking);

// State Machine transitions (Field Staff and Admins)
router.patch('/:id/status', authorize('Super Admin', 'City Manager', 'Field Staff'), validateRequest(jobValidation.updateJobStatusSchema), jobController.updateJobStatus);

// Dispatch functions (Admins only)
router.patch('/:id/assign', authorize('Super Admin', 'City Manager'), validateRequest(jobValidation.assignJobSchema), jobController.assignJob);
router.patch('/:id/reschedule', authorize('Super Admin', 'City Manager'), validateRequest(jobValidation.rescheduleJobSchema), jobController.rescheduleJob);

export default router;
