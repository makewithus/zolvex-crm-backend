import { Request, Response, NextFunction } from 'express';
import { ExpenseService } from '../services/expense.service';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import * as settingsService from '../services/settings.service';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  createExpenseSchema,
  updateExpenseSchema,
  rejectExpenseSchema,
} from '../validations/expense.validation';

const APPROVE_ROLES = ['Super Admin', 'Finance'];

// ─── R2 upload for receipts (same pattern as invoicePdf.service.ts) ──────────

async function uploadReceiptToR2(buffer: Buffer, expenseId: string, originalName: string, mimeType: string): Promise<string | null> {
  const hasR2 = !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );

  if (!hasR2) {
    logger.warn('[ExpenseController] R2 not configured — receipt URL will be null');
    return null;
  }

  const ext = originalName.substring(originalName.lastIndexOf('.')) || '.jpg';
  const key = `expense-receipts/${expenseId}/${Date.now()}${ext}`;

  const client = new S3Client({
    region:   'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  await client.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET!,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));

  return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, '')}/${key}`;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export const listExpenses = async (req: any, res: Response, next: NextFunction) => {
  try {
    const user = req.user;
    const where: any = {};
    const status   = typeof req.query.status   === 'string' ? req.query.status   : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const city_id  = typeof req.query.city_id  === 'string' ? req.query.city_id  : undefined;

    if (status)   where.status   = status;
    if (category) where.category = category;

    // City Manager: only see expenses for their city
    if (user.role === 'City Manager' && user.cityId) {
      where.city_id = user.cityId;
    } else if (city_id) {
      where.city_id = city_id;
    }

    const expenses = await ExpenseService.listExpenses(where);
    res.json({ success: true, data: expenses });
  } catch (err: any) {
    next(err);
  }
};

// ─── Get by ID ────────────────────────────────────────────────────────────────

export const getExpenseById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await ExpenseService.getExpenseById(String(req.params.id));
    res.json({ success: true, data: expense });
  } catch (err: any) {
    if (err.code === 'P2025') return next(new AppError('Expense not found', 404));
    next(err);
  }
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createExpense = async (req: any, res: Response, next: NextFunction) => {
  try {
    const { error, value } = createExpenseSchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    const expense = await ExpenseService.createExpense({
      ...value,
      expense_date: new Date(value.expense_date),
      created_by:   req.user.id,
    });

    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
};

// ─── Update (Draft only) ──────────────────────────────────────────────────────

export const updateExpense = async (req: any, res: Response, next: NextFunction) => {
  try {
    const { error, value } = updateExpenseSchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    if (value.expense_date) value.expense_date = new Date(value.expense_date);

    const expense = await ExpenseService.updateExpense(req.params.id, value, req.user.id);
    res.json({ success: true, data: expense });
  } catch (err: any) {
    if (err.code === 'P2025') return next(new AppError('Expense not found', 404));
    next(err);
  }
};

// ─── Submit ───────────────────────────────────────────────────────────────────

export const submitExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const expense = await ExpenseService.submitExpense(String(req.params.id));
    res.json({ success: true, data: expense });
  } catch (err: any) {
    if (err.code === 'P2025') return next(new AppError('Expense not found', 404));
    next(err);
  }
};

// ─── Approve ──────────────────────────────────────────────────────────────────

export const approveExpense = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!APPROVE_ROLES.includes(req.user.role)) {
      return next(new AppError('Forbidden: Only Super Admin or Finance can approve expenses', 403));
    }
    const expense = await ExpenseService.approveExpense(req.params.id, req.user.id);
    res.json({ success: true, data: expense });
  } catch (err: any) {
    if (err.code === 'P2025') return next(new AppError('Expense not found', 404));
    next(err);
  }
};

// ─── Reject ───────────────────────────────────────────────────────────────────

export const rejectExpense = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!APPROVE_ROLES.includes(req.user.role)) {
      return next(new AppError('Forbidden: Only Super Admin or Finance can reject expenses', 403));
    }
    const { error } = rejectExpenseSchema.validate(req.body);
    if (error) return next(new AppError(error.details[0].message, 400));

    const expense = await ExpenseService.rejectExpense(req.params.id, req.user.id);
    res.json({ success: true, data: expense });
  } catch (err: any) {
    if (err.code === 'P2025') return next(new AppError('Expense not found', 404));
    next(err);
  }
};

// ─── Upload Receipt ───────────────────────────────────────────────────────────

export const uploadReceipt = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return next(new AppError('Receipt file is required', 400));

    let receipt_url: string | null = null;

    try {
      receipt_url = await uploadReceiptToR2(
        req.file.buffer,
        req.params.id,
        req.file.originalname,
        req.file.mimetype,
      );
    } catch (uploadErr: any) {
      logger.error('[ExpenseController] R2 upload failed:', uploadErr.message);
      // Non-blocking: expense record still updated, url stays null
    }

    const expense = await ExpenseService.attachReceipt(req.params.id, receipt_url ?? '');
    res.json({ message: 'Expense deleted successfully' });
  } catch (err) {
    next(err);
  }
};

export const generatePdf = async (req: any, res: Response, next: NextFunction) => {
  try {
    const expense = await ExpenseService.getExpenseById(req.params.id);
    const settings = await settingsService.getAllSettings();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=expense-${expense.expense_number}.pdf`);
    
    doc.pipe(res);
    
    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('ZOLVEX', 50, 45);
    doc.fontSize(10).font('Helvetica').text(settings.company_name || 'Zolvex Services', 50, 70);
    if (settings.company_gstin) doc.text(`GSTIN: ${settings.company_gstin}`, 50, 85);
    if (settings.company_address) doc.text(settings.company_address, 50, 100);
    
    const contactInfo = [];
    if (settings.company_support_email) contactInfo.push(`Email: ${settings.company_support_email}`);
    if (settings.company_support_phone) contactInfo.push(`Phone: ${settings.company_support_phone}`);
    if (contactInfo.length > 0) doc.text(contactInfo.join(' | '), 50, 115);
    
    // EXPENSE text on right
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#333333').text('EXPENSE VOUCHER', 300, 45, { align: 'right' });
    
    // Expense Meta
    doc.fontSize(10).font('Helvetica').fillColor('#000000');
    doc.text(`Expense Number: ${expense.expense_number}`, 350, 85, { align: 'right' });
    doc.text(`Status: ${expense.status}`, 350, 100, { align: 'right' });
    doc.text(`Date: ${new Date(expense.expense_date).toLocaleDateString()}`, 350, 115, { align: 'right' });
    
    // Divider
    doc.moveTo(50, 150).lineTo(545, 150).strokeColor('#e5e7eb').lineWidth(1).stroke();
    
    // Submitted By
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('SUBMITTED BY:', 50, 170);
    doc.font('Helvetica').text(expense.createdBy?.name || 'Unknown', 50, 185);
    if (expense.city) doc.text(`City: ${expense.city.name}`, 50, 200);
    
    // Table Header
    const tableTop = 240;
    doc.rect(50, tableTop, 495, 25).fillColor('#f9fafb').fill();
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10);
    doc.text('Category', 60, tableTop + 8);
    doc.text('Vendor', 180, tableTop + 8);
    doc.text('Description', 280, tableTop + 8);
    doc.text('Amount', 450, tableTop + 8, { width: 85, align: 'right' });
    
    // Table Rows
    let y = tableTop + 35;
    doc.fillColor('#000000').font('Helvetica');
    doc.text(expense.category, 60, y, { width: 110 });
    doc.text(expense.vendor_name || '-', 180, y, { width: 90 });
    doc.text(expense.description || '-', 280, y, { width: 160 });
    doc.text(`Rs. ${Number(expense.amount).toFixed(2)}`, 450, y, { width: 85, align: 'right' });
    y += 25;
    
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    
    // Grand Total
    y += 10;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Grand Total:', 350, y);
    doc.text(`Rs. ${Number(expense.amount).toFixed(2)}`, 450, y, { align: 'right' });
    
    // Footer
    const footerY = 700;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#e5e7eb').stroke();
    
    doc.font('Helvetica-Bold').fontSize(10).text('Authorized Signature', 400, footerY + 15, { align: 'right' });
    doc.moveTo(400, footerY + 50).lineTo(545, footerY + 50).strokeColor('#000000').stroke();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6b7280').text('Generated by ZOLVEX CRM', 50, 760, { align: 'center' });
    
    doc.end();
  } catch (err: any) {
    logger.error('Error generating PDF:', err);
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

// ─── Delete (Draft only) ──────────────────────────────────────────────────────

export const deleteExpense = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await ExpenseService.deleteExpense(String(req.params.id));
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err: any) {
    if (err.code === 'P2025') return next(new AppError('Expense not found', 404));
    next(err);
  }
};
