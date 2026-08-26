import { Request, Response } from 'express';
import { QuoteService } from '../services/quote.service';
import * as settingsService from '../services/settings.service';
import { logger } from '../utils/logger';
import {
  createQuoteSchema,
  updateQuoteSchema,
  sendQuoteSchema,
  rejectQuoteSchema,
  acceptQuoteSchema,
} from '../validations/quote.validation';

export class QuoteController {

  static async createQuote(req: any, res: Response) {
    try {
      const { error, value } = createQuoteSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const quote = await QuoteService.createQuote({ ...value, created_by: req.user!.id });
      return res.status(201).json(quote);
    } catch (err: any) {
      logger.error('Error creating quote:', err);
      return res.status(500).json({ error: 'Failed to create quote' });
    }
  }

  static async getQuotes(req: any, res: Response) {
    try {
      const user = req.user!;
      const { status, customer_id } = req.query;
      const where: any = {};

      if (status)      where.status      = status;
      if (customer_id) where.customer_id = customer_id;

      // RBAC: Technicians only see quotes assigned in their context (no direct assignment on quotes)
      // City Manager: filter by customers with bookings/leads in their city
      if (user.role === 'City Manager') {
        where.customer = {
          OR: [
            { bookings: { some: { city_id: user.cityId } } },
            { leads: { some: { city_id: user.cityId } } }
          ]
        };
      }
      // Technicians have read-only access — no additional filter (they can see all for visibility)

      const quotes = await QuoteService.listQuotes(where);
      return res.json(quotes);
    } catch (err: any) {
      logger.error('Error fetching quotes:', err);
      return res.status(500).json({ error: 'Failed to fetch quotes' });
    }
  }

  static async getQuoteById(req: any, res: Response) {
    try {
      const quote = await QuoteService.getQuoteDetails(req.params.id);
      return res.json(quote);
    } catch (err: any) {
      if (err.code === 'P2025' || err.name === 'NotFoundError') {
        return res.status(404).json({ error: 'Quote not found' });
      }
      logger.error('Error fetching quote:', err);
      return res.status(500).json({ error: 'Failed to fetch quote' });
    }
  }

  static async updateQuote(req: any, res: Response) {
    try {
      const { error, value } = updateQuoteSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const quote = await QuoteService.updateQuote(req.params.id, value, req.user!.id);
      return res.json(quote);
    } catch (err: any) {
      if (err.message?.includes('Only Draft')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('Error updating quote:', err);
      return res.status(500).json({ error: 'Failed to update quote' });
    }
  }

  static async sendQuote(req: any, res: Response) {
    try {
      const { error, value } = sendQuoteSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const quote = await QuoteService.sendQuote(req.params.id, req.user!.id, value.note);
      return res.json(quote);
    } catch (err: any) {
      if (err.message?.includes('Invalid quote status transition')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('Error sending quote:', err);
      return res.status(500).json({ error: 'Failed to send quote' });
    }
  }

  static async acceptQuote(req: any, res: Response) {
    try {
      const { error, value } = acceptQuoteSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const quote = await QuoteService.acceptQuote(req.params.id, req.user!.id, value.note);
      return res.json(quote);
    } catch (err: any) {
      if (err.message?.includes('Invalid quote status transition')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('Error accepting quote:', err);
      return res.status(500).json({ error: 'Failed to accept quote' });
    }
  }

  static async rejectQuote(req: any, res: Response) {
    try {
      const { error, value } = rejectQuoteSchema.validate(req.body);
      if (error) return res.status(400).json({ error: error.details[0].message });

      const quote = await QuoteService.rejectQuote(req.params.id, value.reason, req.user!.id);
      return res.json(quote);
    } catch (err: any) {
      if (err.message?.includes('Invalid quote status transition')) {
        return res.status(400).json({ error: err.message });
      }
      logger.error('Error rejecting quote:', err);
      return res.status(500).json({ error: 'Failed to reject quote' });
    }
  }

  static async generatePdf(req: any, res: Response) {
    try {
      const quote = await QuoteService.getQuoteDetails(req.params.id as string);
      const settings = await settingsService.getAllSettings();

      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=quotation-${quote.quote_id}.pdf`);
      
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
      
      // QUOTATION text on right
      doc.fontSize(24).font('Helvetica-Bold').fillColor('#333333').text('QUOTATION', 400, 45, { align: 'right' });
      
      // Quote Meta
      doc.fontSize(10).font('Helvetica').fillColor('#000000');
      doc.text(`Quote Number: ${quote.quote_id}`, 350, 85, { align: 'right' });
      doc.text(`Status: ${quote.status}`, 350, 100, { align: 'right' });
      doc.text(`Date: ${new Date(quote.created_at).toLocaleDateString()}`, 350, 115, { align: 'right' });
      if (quote.valid_until) {
        doc.text(`Valid Until: ${new Date(quote.valid_until).toLocaleDateString()}`, 350, 130, { align: 'right' });
      }
      
      // Divider
      doc.moveTo(50, 150).lineTo(545, 150).strokeColor('#e5e7eb').lineWidth(1).stroke();
      
      // Bill To
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('QUOTE FOR:', 50, 170);
      doc.font('Helvetica').text(quote.customer.name || 'Customer Name', 50, 185);
      doc.text(`Phone: ${quote.customer.phone}`, 50, 200);
      
      // Table Header
      const tableTop = 240;
      doc.rect(50, tableTop, 495, 25).fillColor('#f9fafb').fill();
      doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10);
      doc.text('Description', 60, tableTop + 8);
      doc.text('Qty', 280, tableTop + 8);
      doc.text('Unit Price', 320, tableTop + 8, { width: 70, align: 'right' });
      doc.text('Total', 450, tableTop + 8, { width: 85, align: 'right' });
      
      // Table Rows
      let y = tableTop + 35;
      doc.fillColor('#000000').font('Helvetica');
      if (quote.line_items && quote.line_items.length > 0) {
        quote.line_items.forEach((item: any) => {
          doc.text(item.description, 60, y, { width: 210 });
          doc.text(item.quantity.toString(), 280, y);
          doc.text(`Rs. ${Number(item.unit_price).toFixed(2)}`, 320, y, { width: 70, align: 'right' });
          const lineTotal = Number(item.quantity) * Number(item.unit_price);
          doc.text(`Rs. ${lineTotal.toFixed(2)}`, 450, y, { width: 85, align: 'right' });
          y += 25;
        });
      }
      
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
      
      // Summary
      const summaryX = 350;
      y += 15;
      doc.text('Subtotal:', summaryX, y);
      doc.text(`Rs. ${Number(quote.subtotal).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
      
      if (Number(quote.discount_amount) > 0) {
        doc.text('Discount:', summaryX, y);
        doc.text(`- Rs. ${Number(quote.discount_amount).toFixed(2)}`, 450, y, { align: 'right' });
        y += 20;
      }
      
      doc.text(`Tax:`, summaryX, y);
      doc.text(`Rs. ${Number(quote.tax_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
      
      // Grand Total
      doc.moveTo(summaryX, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
      y += 10;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('Grand Total:', summaryX, y);
      doc.text(`Rs. ${Number(quote.total_amount).toFixed(2)}`, 450, y, { align: 'right' });
      
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
  }

  static async markViewed(req: any, res: Response) {
    try {
      const quote = await QuoteService.markViewed(req.params.id);
      return res.json(quote);
    } catch (err: any) {
      logger.error('Error marking quote viewed:', err);
      return res.status(500).json({ error: 'Failed to mark quote viewed' });
    }
  }
}
