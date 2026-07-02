import { Request, Response } from 'express';
import * as cityService from '../services/city.service';
import { sendSuccess } from '../utils/response.util';

export const getCities = async (req: Request, res: Response) => {
  const cities = await cityService.getAllCities();
  sendSuccess(res, 200, 'Cities retrieved', cities);
};

export const createCity = async (req: Request, res: Response) => {
  const city = await cityService.createCity(req.body);
  sendSuccess(res, 201, 'City created', city);
};

export const updateCity = async (req: Request, res: Response) => {
  const city = await cityService.updateCity(req.params.id as string, req.body);
  sendSuccess(res, 200, 'City updated', city);
};
