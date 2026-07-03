import { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import * as userService from '../services/user.service';
import { sendSuccess } from '../utils/response.util';

export const login = async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  const result = await authService.loginUser(phone, password);
  sendSuccess(res, 200, 'Login successful', result);
};

// Returns the authenticated user's authoritative profile from the DB.
// Used by frontend to validate role/active status after JWT decode.
export const getMe = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const profile = await userService.getUserById(user.id);
  sendSuccess(res, 200, 'Profile retrieved', profile);
};
