import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';
import * as invoiceService from '../services/invoice.service';
import * as settingsService from '../services/settings.service';

const prisma = new PrismaClient();

export const getInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, city_id } = req.query;
    const filters: any = {};
    if (status) filters.status = status as string;
    if (city_id) filters.city_id = city_id as string;

    const invoices = await invoiceService.getInvoices(filters);
    res.json({ success: true, data: invoices });
  } catch (error) {
    next(error);
  }
};

export const getInvoiceById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.id as string);
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

export const createInvoiceFromBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { issue_date, due_date } = req.body;
    const bookingId = req.params.bookingId;
    
    const parsedIssueDate = issue_date ? new Date(issue_date) : undefined;
    const parsedDueDate = due_date ? new Date(due_date) : undefined;
    
    const invoice = await invoiceService.generateInvoiceFromBooking(
      bookingId as string,
      (req as any).user.id,
      parsedIssueDate,
      parsedDueDate
    );
    
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

export const updateInvoiceStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, reason } = req.body;
    const invoice = await invoiceService.updateInvoiceStatus(
      req.params.id as string, 
      status, 
      (req as any).user.id,
      (req as any).user.role,
      reason
    );
    res.json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

export const getCustomerInvoices = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ledger = await invoiceService.getCustomerLedger(req.params.id as string);
    res.json({ success: true, data: ledger });
  } catch (error) {
    next(error);
  }
};

export const generatePdf = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.id as string);
    const booking = await prisma.booking.findUnique({ where: { id: invoice.booking_id } });
    const settings = await settingsService.getAllSettings();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoice_number}.pdf`);
    
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
    
    // INVOICE text on right
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#333333').text('INVOICE', 400, 45, { align: 'right' });
    
    // Invoice Meta
    doc.fontSize(10).font('Helvetica').fillColor('#000000');
    doc.text(`Invoice Number: ${invoice.invoice_number}`, 350, 85, { align: 'right' });
    doc.text(`Status: ${invoice.status}`, 350, 100, { align: 'right' });
    doc.text(`Issue Date: ${new Date(invoice.issue_date).toLocaleDateString()}`, 350, 115, { align: 'right' });
    doc.text(`Due Date: ${new Date(invoice.due_date).toLocaleDateString()}`, 350, 130, { align: 'right' });
    
    // Divider
    doc.moveTo(50, 150).lineTo(545, 150).strokeColor('#e5e7eb').lineWidth(1).stroke();
    
    // Bill To
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('BILL TO:', 50, 170);
    doc.font('Helvetica').text(invoice.customer_name || 'Customer Name', 50, 185);
    doc.text(`Phone: ${invoice.customer_phone}`, 50, 200);
    doc.text(`Address: ${invoice.billing_address || 'N/A'}`, 50, 215, { width: 250 });
    
    // Booking / Job Details
    doc.font('Helvetica-Bold').text('REFERENCE:', 350, 170, { align: 'right' });
    doc.font('Helvetica').text(`Booking ID: ${booking?.booking_id || 'N/A'}`, 350, 185, { align: 'right' });
    if (invoice.technician_id) {
       doc.text(`Job Tech ID: ${invoice.technician_id}`, 350, 200, { align: 'right' });
    }
    
    // Table Header
    const tableTop = 270;
    doc.rect(50, tableTop, 495, 25).fillColor('#f9fafb').fill();
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10);
    doc.text('Service', 60, tableTop + 8);
    doc.text('Qty', 280, tableTop + 8);
    doc.text('Unit Price', 320, tableTop + 8, { width: 70, align: 'right' });
    doc.text('Total', 450, tableTop + 8, { width: 85, align: 'right' });
    
    // Table Rows
    let y = tableTop + 35;
    doc.fillColor('#000000').font('Helvetica');
    if (invoice.items && invoice.items.length > 0) {
      invoice.items.forEach(item => {
        doc.text(item.service_name, 60, y, { width: 210 });
        doc.text(item.quantity.toString(), 280, y);
        doc.text(`Rs. ${Number(item.unit_price).toFixed(2)}`, 320, y, { width: 70, align: 'right' });
        doc.text(`Rs. ${Number(item.line_total).toFixed(2)}`, 450, y, { width: 85, align: 'right' });
        y += 25;
      });
    }
    
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    
    // Summary
    const summaryX = 350;
    y += 15;
    doc.text('Subtotal:', summaryX, y);
    doc.text(`Rs. ${Number(invoice.base_amount).toFixed(2)}`, 450, y, { align: 'right' });
    y += 20;
    
    if (Number(invoice.discount_amount) > 0) {
      doc.text('Discount:', summaryX, y);
      doc.text(`- Rs. ${Number(invoice.discount_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
    }
    
    doc.text(`CGST (${Number(invoice.cgst_percent)}%):`, summaryX, y);
    doc.text(`Rs. ${Number(invoice.cgst_amount).toFixed(2)}`, 450, y, { align: 'right' });
    y += 20;
    
    doc.text(`SGST (${Number(invoice.sgst_percent)}%):`, summaryX, y);
    doc.text(`Rs. ${Number(invoice.sgst_amount).toFixed(2)}`, 450, y, { align: 'right' });
    y += 20;
    
    if (Number(invoice.igst_percent) > 0) {
      doc.text(`IGST (${Number(invoice.igst_percent)}%):`, summaryX, y);
      doc.text(`Rs. ${Number(invoice.igst_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
    }
    
    // Grand Total
    doc.moveTo(summaryX, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Grand Total:', summaryX, y);
    doc.text(`Rs. ${Number(invoice.final_amount).toFixed(2)}`, 450, y, { align: 'right' });
    
    y += 25;
    doc.font('Helvetica').fontSize(10);
    doc.text('Amount Paid:', summaryX, y);
    doc.text(`Rs. ${Number(invoice.amount_paid).toFixed(2)}`, 450, y, { align: 'right' });
    
    y += 15;
    doc.font('Helvetica-Bold');
    doc.text('Balance Due:', summaryX, y);
    doc.text(`Rs. ${Number(invoice.balance_due).toFixed(2)}`, 450, y, { align: 'right' });
    
    // Footer
    const footerY = 700;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#e5e7eb').stroke();
    
    if (settings.invoice_footer_note) {
      doc.font('Helvetica-Bold').fontSize(10).text('Note', 50, footerY + 15);
      doc.font('Helvetica').fontSize(8).text(settings.invoice_footer_note, 50, footerY + 30, { width: 300 });
    }
      
    doc.font('Helvetica-Bold').fontSize(10).text('Authorized Signature', 400, footerY + 15, { align: 'right' });
    doc.moveTo(400, footerY + 50).lineTo(545, footerY + 50).strokeColor('#000000').stroke();
    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6b7280').text('Generated by ZOLVEX CRM', 50, 760, { align: 'center' });
    
    doc.end();
  } catch (error) {
    next(error);
  }
};
