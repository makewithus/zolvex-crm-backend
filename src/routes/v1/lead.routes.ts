import { Router } from 'express';
import { getLeads, getLeadById, createLead, updateLead, addLeadNote } from '../../controllers/lead.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { createLeadSchema, updateLeadSchema, createLeadNoteSchema } from '../../validations/lead.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);

// Apply central RBAC protection
const leadRoles = ['Super Admin', 'City Manager', 'Support Agent'];

router.get('/', authorize(...leadRoles), catchAsync(getLeads));
router.get('/:id', authorize(...leadRoles), catchAsync(getLeadById));
router.post('/', authorize(...leadRoles), validateRequest(createLeadSchema), catchAsync(createLead));
router.patch('/:id', authorize(...leadRoles), validateRequest(updateLeadSchema), catchAsync(updateLead));
router.post('/:id/notes', authorize(...leadRoles), validateRequest(createLeadNoteSchema), catchAsync(addLeadNote));

export default router;
