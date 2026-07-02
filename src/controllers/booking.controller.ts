import { Request, Response } from 'express';
import * as bookingService from '../services/booking.service';

export const getBookings = async (req: Request, res: Response) => {
  const result = await bookingService.getBookings(req.query);
  res.status(200).json({ status: 'success', data: result });
};

export const getBookingById = async (req: Request, res: Response) => {
  const booking = await bookingService.getBookingById(req.params.id as string);
  res.status(200).json({ status: 'success', data: booking });
};

export const createBooking = async (req: any, res: Response) => {
  const booking = await bookingService.createBooking(req.body, req.user!.id);
  res.status(201).json({ status: 'success', data: booking });
};

export const convertLeadToBooking = async (req: any, res: Response) => {
  const booking = await bookingService.convertLeadToBooking(req.params.leadId, req.body, req.user!.id);
  res.status(201).json({ status: 'success', data: booking });
};

export const updateBooking = async (req: any, res: Response) => {
  const booking = await bookingService.updateBooking(req.params.id, req.body, req.user!.id);
  res.status(200).json({ status: 'success', data: booking });
};

export const updateBookingStatus = async (req: any, res: Response) => {
  const booking = await bookingService.updateBookingStatus(req.params.id, req.body.status, req.user!.id);
  res.status(200).json({ status: 'success', data: booking });
};

export const rescheduleBooking = async (req: any, res: Response) => {
  const booking = await bookingService.rescheduleBooking(req.params.id, req.body, req.user!.id);
  res.status(200).json({ status: 'success', data: booking });
};

export const cancelBooking = async (req: any, res: Response) => {
  const booking = await bookingService.cancelBooking(req.params.id, req.body.cancel_reason, req.user!.id);
  res.status(200).json({ status: 'success', data: booking });
};
