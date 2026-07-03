import { Request, Response, NextFunction } from 'express';
import * as paymentService from '../services/payment.service';
import PDFDocument from 'pdfkit';
import { AppError } from '../utils/AppError';

export const recordPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await paymentService.recordPayment(
      req.body,
      (req as any).user.id,
      (req as any).user.role,
      req.ip
    );
    res.status(201).json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

export const getPayments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { invoice_id, customer_id } = req.query;
    const filters: any = {};
    if (invoice_id) filters.invoice_id = invoice_id as string;
    if (customer_id) filters.customer_id = customer_id as string;
    
    const payments = await paymentService.getPayments(filters);
    res.json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
};

export const getPaymentById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id as string);
    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
};

export const downloadReceipt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await paymentService.getPaymentById(req.params.id as string);
    
    // We need the invoice for customer details
    const invoice = (payment as any).invoice;
    if (!invoice) {
      throw new AppError('Associated invoice not found', 404);
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Receipt-${payment.payment_number}.pdf`);
    
    doc.pipe(res);
    
    // Header
    doc.fontSize(20).font('Helvetica-Bold').fillColor('#2563eb').text('ZOLVEX CRM', 50, 45);
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#333333').text('RECEIPT', 400, 45, { align: 'right' });
    
    // Receipt Meta
    doc.fontSize(10).font('Helvetica').fillColor('#000000');
    doc.text(`Receipt Number: ${payment.payment_number}`, 350, 85, { align: 'right' });
    doc.text(`Payment Date: ${new Date(payment.payment_date).toLocaleDateString()}`, 350, 100, { align: 'right' });
    doc.text(`Status: ${payment.payment_status}`, 350, 115, { align: 'right' });
    
    // Divider
    doc.moveTo(50, 140).lineTo(545, 140).strokeColor('#e5e7eb').lineWidth(1).stroke();
    
    // Received From
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('RECEIVED FROM:', 50, 160);
    doc.font('Helvetica').text(invoice.customer_name || 'Customer Name', 50, 175);
    doc.text(`Phone: ${invoice.customer_phone}`, 50, 190);
    
    // Reference Details
    doc.font('Helvetica-Bold').text('REFERENCE:', 350, 160, { align: 'right' });
    doc.font('Helvetica').text(`Invoice Number: ${invoice.invoice_number}`, 350, 175, { align: 'right' });
    
    // Payment Details Box
    doc.rect(50, 230, 495, 100).fillColor('#f9fafb').strokeColor('#e5e7eb').lineWidth(1).fillAndStroke();
    
    doc.fillColor('#374151').font('Helvetica-Bold').fontSize(12);
    doc.text('Payment Details', 70, 245);
    
    doc.fontSize(10).font('Helvetica');
    doc.text('Amount Received:', 70, 275);
    doc.font('Helvetica-Bold').text(`Rs. ${Number(payment.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 200, 275);
    
    doc.font('Helvetica').text('Payment Method:', 70, 295);
    doc.text(payment.payment_method, 200, 295);

    if (payment.notes) {
       doc.text('Reference / Notes:', 70, 315);
       doc.text(payment.notes, 200, 315);
    }
    
    // Summary
    doc.font('Helvetica').text('Invoice Total:', 380, 275);
    doc.text(`Rs. ${Number(invoice.final_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, 275, { align: 'right', width: 75 });
    
    doc.text('Amount Paid:', 380, 295);
    doc.text(`Rs. ${Number(invoice.amount_paid).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, 295, { align: 'right', width: 75 });
    
    doc.font('Helvetica-Bold').fillColor('#ef4444').text('Balance Due:', 380, 315);
    doc.text(`Rs. ${Number(invoice.balance_due).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 450, 315, { align: 'right', width: 75 });
    
    // Footer
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280');
    doc.text('Thank you for your business.', 50, 720, { align: 'center', width: 495 });
    doc.text('This is a computer generated receipt and requires no signature.', 50, 735, { align: 'center', width: 495 });
    
    doc.end();
  } catch (error) {
    next(error);
  }
};
