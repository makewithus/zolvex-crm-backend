import { Request, Response } from 'express';
import * as serviceService from '../services/service.service';
import { sendSuccess } from '../utils/response.util';

export const getServices = async (req: Request, res: Response) => {
  const services = await serviceService.getAllServices();
  sendSuccess(res, 200, 'Services retrieved', services);
};

export const createService = async (req: Request, res: Response) => {
  const service = await serviceService.createService(req.body);
  sendSuccess(res, 201, 'Service created', service);
};
