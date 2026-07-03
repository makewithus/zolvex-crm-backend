import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import * as invoiceService from '../services/invoice.service';

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
    // Simple PDF generation logic using PDFKit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoice_number}.pdf`);
    
    doc.pipe(res);
    
    doc.fontSize(25).text(`Invoice ${invoice.invoice_number}`, 100, 100);
    doc.fontSize(12).text(`Status: ${invoice.status}`, 100, 150);
    doc.text(`Customer: ${invoice.customer_name}`, 100, 170);
    doc.text(`Total: ₹${invoice.final_amount}`, 100, 190);
    
    doc.end();
  } catch (error) {
    next(error);
  }
};
