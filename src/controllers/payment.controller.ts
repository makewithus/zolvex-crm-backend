import { Request, Response, NextFunction } from 'express';
import * as paymentService from '../services/payment.service';

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
