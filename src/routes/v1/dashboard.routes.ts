import { Router } from 'express';
import * as dashboardController from '../../controllers/dashboard.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);

// All dashboard data is read-only and role-scoped inside the service
// Field Staff see only their own assigned data; Finance see financial views only
const dashboardRoles = ['Super Admin', 'City Manager', 'Support Agent', 'Finance', 'Field Staff'];

router.get('/kpis',              authorize(...dashboardRoles), catchAsync(dashboardController.getKPIs));
router.get('/activity',          authorize(...dashboardRoles), catchAsync(dashboardController.getActivity));
router.get('/upcoming-bookings', authorize(...dashboardRoles), catchAsync(dashboardController.getUpcomingBookings));
router.get('/revenue',           authorize('Super Admin', 'Finance'), catchAsync(dashboardController.getRevenue));
router.get('/pipeline',          authorize(...dashboardRoles), catchAsync(dashboardController.getPipeline));

export default router;
