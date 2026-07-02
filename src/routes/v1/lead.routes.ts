import { Router } from 'express';
import { getLeads, createLead, updateLead, addLeadNote } from '../../controllers/lead.controller';
import { protect } from '../../middlewares/auth.middleware';
import { validateRequest } from '../../middlewares/validate.middleware';
import { createLeadSchema, updateLeadSchema, createLeadNoteSchema } from '../../validations/lead.validation';
import { catchAsync } from '../../utils/catchAsync';

const router = Router();
router.use(protect);
router.get('/', catchAsync(getLeads));
router.post('/', validateRequest(createLeadSchema), catchAsync(createLead));
router.patch('/:id', validateRequest(updateLeadSchema), catchAsync(updateLead));
router.post('/:id/notes', validateRequest(createLeadNoteSchema), catchAsync(addLeadNote));

export default router;
