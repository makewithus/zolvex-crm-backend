import { Request, Response, NextFunction } from 'express';
import * as feedbackService from '../services/feedback.service';

export const createFeedback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await feedbackService.createFeedback({
      ...req.body,
      submitted_by: (req as any).user.id as string,
    });
    res.status(201).json({ success: true, data });
  } catch (e) { next(e); }
};

export const getFeedbacks = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customer_id, booking_id, rating } = req.query;
    const data = await feedbackService.getFeedbacks({
      customer_id: customer_id as string,
      booking_id:  booking_id  as string,
      rating:      rating ? Number(rating) : undefined,
    });
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const getFeedbackById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await feedbackService.getFeedbackById(req.params.id as string);
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const getFeedbackStats = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await feedbackService.getFeedbackStats();
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const updateFeedback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await feedbackService.updateFeedback(String(req.params.id), {
      rating:  req.body.rating,
      comment: req.body.comment,
    });
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const deleteFeedback = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await feedbackService.deleteFeedback(String(req.params.id));
    res.json({ success: true, message: 'Feedback deleted.' });
  } catch (e) { next(e); }
};
