import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';
import { upload } from '../../middlewares/upload.middleware';
import {
  listExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  submitExpense,
  approveExpense,
  rejectExpense,
  uploadReceipt,
  deleteExpense,
  generatePdf,
} from '../../controllers/expense.controller';

const router = Router();
router.use(protect);

// Finance-capable roles
const FINANCE_ROLES = ['Super Admin', 'City Manager', 'Finance'];

// List + Get
router.get('/',    authorize(...FINANCE_ROLES), listExpenses);
router.get('/:id', authorize(...FINANCE_ROLES), getExpenseById);
router.get('/:id/pdf', authorize(...FINANCE_ROLES), generatePdf);

// Create
router.post('/', authorize(...FINANCE_ROLES), createExpense);

// Update (Draft only)
router.put('/:id', authorize(...FINANCE_ROLES), updateExpense);

// Status transitions
router.patch('/:id/submit',  authorize(...FINANCE_ROLES),               submitExpense);
router.patch('/:id/approve', authorize('Super Admin', 'Finance'),        approveExpense);
router.patch('/:id/reject',  authorize('Super Admin', 'Finance'),        rejectExpense);

// Receipt upload (image only, 5MB limit via existing upload middleware)
router.post('/:id/receipt', authorize(...FINANCE_ROLES), upload.single('receipt'), uploadReceipt);

// Delete (Draft only, Super Admin only)
router.delete('/:id', authorize('Super Admin'), deleteExpense);

export default router;
