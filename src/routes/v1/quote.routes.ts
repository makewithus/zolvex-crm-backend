import { Router } from 'express';
import { QuoteController } from '../../controllers/quote.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/rbac.middleware';

const router = Router();
router.use(protect);

// Create — Sales / Admin / City Manager
router.post(
  '/',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  QuoteController.createQuote
);

// Read — All roles
router.get('/',    QuoteController.getQuotes);
router.get('/:id', QuoteController.getQuoteById);
router.get('/:id/pdf', QuoteController.generatePdf);

// Update (Draft only) — creator roles
router.put(
  '/:id',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  QuoteController.updateQuote
);

// Send to customer
router.post(
  '/:id/send',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  QuoteController.sendQuote
);

// Mark viewed (public-ish — called by customer tracking link, so no role restriction)
router.post('/:id/view', QuoteController.markViewed);

// Accept (customer-side action proxied through staff, OR direct customer link)
router.post(
  '/:id/accept',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  QuoteController.acceptQuote
);

// Reject
router.post(
  '/:id/reject',
  authorize('Super Admin', 'City Manager', 'Support Agent'),
  QuoteController.rejectQuote
);

export default router;
