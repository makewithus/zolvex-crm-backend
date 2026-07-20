/**
 * R2 INVOICE PDF SERVICE
 *
 * Generates a PDF buffer for an invoice and uploads it to Cloudflare R2.
 * Called AFTER the invoice transaction commits — never inside a transaction.
 *
 * Sequence:
 *   1. Invoice row committed to DB (in job.service.ts or invoice.controller.ts)
 *   2. generateAndUploadInvoicePdf(invoice_id) called asynchronously
 *   3. PDF generated as buffer (never streamed to disk)
 *   4. Buffer uploaded to R2
 *   5. Invoice.pdf_url updated
 *
 * If R2 is unavailable: invoice exists, pdf_url stays null.
 * The existing streaming endpoint (GET /invoices/:id/pdf) regenerates on demand.
 *
 * Feature flag: R2_INVOICE_PDF_ENABLED=true to activate.
 * Default: false (safe — streams as before).
 */

import { PrismaClient } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../utils/logger';
import * as settingsService from './settings.service';

const prisma = new PrismaClient();

function getR2Client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Generates a PDF buffer from an invoice and uploads it to R2.
 * Returns the public URL, or null if R2 is not configured / disabled.
 *
 * NEVER throws — failures are logged silently so they don't affect callers.
 */
export const generateAndUploadInvoicePdf = async (invoice_id: string): Promise<string | null> => {
  if (process.env.R2_INVOICE_PDF_ENABLED !== 'true') return null;

  const hasR2 = !!(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET &&
    process.env.R2_PUBLIC_URL
  );
  if (!hasR2) {
    logger.warn('[InvoicePdf] R2_INVOICE_PDF_ENABLED=true but R2 credentials are missing — skipping');
    return null;
  }

  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoice_id },
      include: { items: true }
    });
    if (!invoice) {
      logger.warn(`[InvoicePdf] Invoice ${invoice_id} not found — skipping PDF upload`);
      return null;
    }

    const booking = await prisma.booking.findUnique({ where: { id: invoice.booking_id } });
    const settings = await settingsService.getAllSettings();

    // Build PDF buffer using pdfkit
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── PDF content (mirrors invoice.controller.ts exactly) ──────────────
      doc.fontSize(20).font('Helvetica-Bold').text('ZOLVEX', 50, 45);
      doc.fontSize(10).font('Helvetica').text(settings.company_name || 'Zolvex Services', 50, 70);
      if (settings.company_gstin) doc.text(`GSTIN: ${settings.company_gstin}`, 50, 85);
      if (settings.company_address) doc.text(settings.company_address, 50, 100);
      
      const contactInfo = [];
      if (settings.company_support_email) contactInfo.push(`Email: ${settings.company_support_email}`);
      if (settings.company_support_phone) contactInfo.push(`Phone: ${settings.company_support_phone}`);
      if (contactInfo.length > 0) doc.text(contactInfo.join(' | '), 50, 115);
      doc.fontSize(24).font('Helvetica-Bold').fillColor('#333333').text('INVOICE', 400, 45, { align: 'right' });
      doc.fontSize(10).font('Helvetica').fillColor('#000000');
      doc.text(`Invoice Number: ${invoice.invoice_number}`, 350, 85, { align: 'right' });
      doc.text(`Status: ${invoice.status}`, 350, 100, { align: 'right' });
      doc.text(`Issue Date: ${new Date(invoice.issue_date).toLocaleDateString()}`, 350, 115, { align: 'right' });
      doc.text(`Due Date: ${new Date(invoice.due_date).toLocaleDateString()}`, 350, 130, { align: 'right' });
      doc.moveTo(50, 150).lineTo(545, 150).strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('BILL TO:', 50, 170);
      doc.font('Helvetica').text(invoice.customer_name || 'Customer Name', 50, 185);
      doc.text(`Phone: ${invoice.customer_phone}`, 50, 200);
      doc.text(`Address: ${invoice.billing_address || 'N/A'}`, 50, 215, { width: 250 });
      doc.font('Helvetica-Bold').text('REFERENCE:', 350, 170, { align: 'right' });
      doc.font('Helvetica').text(`Booking ID: ${booking?.booking_id || 'N/A'}`, 350, 185, { align: 'right' });
      const tableTop = 270;
      doc.rect(50, tableTop, 495, 25).fillColor('#f9fafb').fill();
      doc.fillColor('#374151').font('Helvetica-Bold').fontSize(10);
      doc.text('Service', 60, tableTop + 8);
      doc.text('Qty', 280, tableTop + 8);
      doc.text('Unit Price', 320, tableTop + 8, { width: 70, align: 'right' });
      doc.text('Total', 450, tableTop + 8, { width: 85, align: 'right' });
      let y = tableTop + 35;
      doc.fillColor('#000000').font('Helvetica');
      if (invoice.items?.length > 0) {
        invoice.items.forEach(item => {
          doc.text(item.service_name, 60, y, { width: 210 });
          doc.text(item.quantity.toString(), 280, y);
          doc.text(`Rs. ${Number(item.unit_price).toFixed(2)}`, 320, y, { width: 70, align: 'right' });
          doc.text(`Rs. ${Number(item.line_total).toFixed(2)}`, 450, y, { width: 85, align: 'right' });
          y += 25;
        });
      }
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
      const summaryX = 350;
      y += 15;
      doc.text('Subtotal:', summaryX, y);
      doc.text(`Rs. ${Number(invoice.base_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
      doc.text(`CGST (${Number(invoice.cgst_percent)}%):`, summaryX, y);
      doc.text(`Rs. ${Number(invoice.cgst_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
      doc.text(`SGST (${Number(invoice.sgst_percent)}%):`, summaryX, y);
      doc.text(`Rs. ${Number(invoice.sgst_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 20;
      doc.moveTo(summaryX, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
      y += 10;
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('Grand Total:', summaryX, y);
      doc.text(`Rs. ${Number(invoice.final_amount).toFixed(2)}`, 450, y, { align: 'right' });
      y += 25;
      doc.font('Helvetica').fontSize(10);
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
    });

    // Upload buffer to R2
    const key = `invoices/${invoice.invoice_number}-${Date.now()}.pdf`;
    const bucket = process.env.R2_BUCKET!;
    const publicUrl = process.env.R2_PUBLIC_URL!;

    await getR2Client().send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        buffer,
      ContentType: 'application/pdf',
    }));

    const url = `${publicUrl.replace(/\/$/, '')}/${key}`;

    // Update invoice row with the URL (outside transaction — safe)
    await prisma.invoice.update({
      where: { id: invoice_id },
      data: { pdf_url: url }
    });

    logger.info(`[InvoicePdf] Uploaded PDF for ${invoice.invoice_number} → ${url}`);
    return url;

  } catch (err: any) {
    logger.error(`[InvoicePdf] Failed to generate/upload PDF for invoice ${invoice_id}: ${err.message}`);
    return null; // Never throw — PDF upload failure must not affect the caller
  }
};
