import { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { sendSuccess } from '../utils/response.util';

export const login = async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  const result = await authService.loginUser(phone, password);
  sendSuccess(res, 200, 'Login successful', result);
};
