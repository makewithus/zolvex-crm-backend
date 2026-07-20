import { Request, Response, NextFunction } from 'express';
import * as addressService from '../services/customerAddress.service';

export const getAddresses = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await addressService.getCustomerAddresses(req.params.customerId as string);
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const createAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await addressService.createCustomerAddress(req.params.customerId as string, req.body);
    res.status(201).json({ success: true, data });
  } catch (e) { next(e); }
};

export const updateAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await addressService.updateCustomerAddress(
      req.params.addressId as string,
      req.params.customerId as string,
      req.body
    );
    res.json({ success: true, data });
  } catch (e) { next(e); }
};

export const deleteAddress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await addressService.deleteCustomerAddress(req.params.addressId as string, req.params.customerId as string);
    res.json({ success: true, message: 'Address deleted' });
  } catch (e) { next(e); }
};
