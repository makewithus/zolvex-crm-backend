import { Router } from 'express';
import authRoutes from './auth.routes';
import cityRoutes from './city.routes';
import userRoutes from './user.routes';
import roleRoutes from './role.routes';
import serviceRoutes from './service.routes';
import pricingRuleRoutes from './pricingRule.routes';
import leadRoutes from './lead.routes';
import customerRoutes from './customer.routes';
import bookingRoutes from './booking.routes';
import jobRoutes from './job.routes';
import lostReasonRoutes from './lostReason.routes';
import dashboardRoutes from './dashboard.routes';
import invoiceRoutes from './invoice.routes';
import paymentRoutes from './payment.routes';
import reportRoutes from './report.routes';
import complaintRoutes from './complaint.routes';
import quoteRoutes from './quote.routes';
import settingsRoutes from './settings.routes';
import checklistRoutes from './checklist.routes';
import feedbackRoutes from './feedback.routes';
import webhookRoutes from './webhook.routes';
import whatsappRoutes from './whatsapp.routes';
import whatsappInboxRoutes from './whatsappInbox.routes';
import alertRoutes from './alert.routes';
import searchRoutes from './search.routes';
import expenseRoutes from './expense.routes';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ status: 'success', message: 'ZOLVEX CRM API v1 is running' });
});

router.use('/auth', authRoutes);
router.use('/cities', cityRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/services', serviceRoutes);
router.use('/pricing-rules', pricingRuleRoutes);
router.use('/bookings', bookingRoutes);
router.use('/jobs', jobRoutes);
router.use('/leads', leadRoutes);
router.use('/alerts', alertRoutes);
router.use('/search', searchRoutes);
router.use('/customers', customerRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/lost-reasons', lostReasonRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/payments', paymentRoutes);
router.use('/reports', reportRoutes);
router.use('/complaints', complaintRoutes);
router.use('/quotes', quoteRoutes);    // Sprint 11.2 — Quotation module (activated)
router.use('/settings', settingsRoutes);
router.use('/checklists', checklistRoutes);  // Checklist template management
router.use('/feedback', feedbackRoutes);
router.use('/webhook', webhookRoutes);   // Public endpoint — no protect middleware
router.use('/whatsapp-webhook', whatsappRoutes); // Public endpoint for Meta WhatsApp
router.use('/whatsapp', whatsappInboxRoutes);    // Protected CRM WhatsApp Inbox
router.use('/expenses', expenseRoutes);  // Finance Module — Expense Tracking

export default router;
