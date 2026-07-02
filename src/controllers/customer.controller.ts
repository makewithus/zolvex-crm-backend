import { Request, Response } from 'express';
import * as customerService from '../services/customer.service';
import { sendSuccess } from '../utils/response.util';

export const getCustomers = async (req: Request, res: Response) => {
  const customers = await customerService.getAllCustomers();
  sendSuccess(res, 200, 'Customers retrieved', customers);
};

export const getCustomerById = async (req: Request, res: Response) => {
  const customer = await customerService.getCustomerById(req.params.id as string);
  sendSuccess(res, 200, 'Customer retrieved', customer);
};

export const updateCustomer = async (req: Request, res: Response) => {
  const customer = await customerService.updateCustomer(req.params.id as string, req.body);
  sendSuccess(res, 200, 'Customer updated', customer);
};
