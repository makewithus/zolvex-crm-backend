import { Request, Response } from 'express';
import { QuoteService } from '../services/quote.service';
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
        where.customer = { bookings: { some: { city_id: user.cityId } } };
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
