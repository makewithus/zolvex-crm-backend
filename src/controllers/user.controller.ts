import { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { sendSuccess } from '../utils/response.util';

export const getUsers = async (req: Request, res: Response) => {
  const user = (req as any).user;
  const users = await userService.getAllUsers(user.role, user.cityId);
  sendSuccess(res, 200, 'Users retrieved', users);
};

export const createUser = async (req: Request, res: Response) => {
  const { password, ...userData } = req.body;
  const newUser = await userService.createUser(userData, password);
  sendSuccess(res, 201, 'User created', { id: newUser.id });
};

export const updateUser = async (req: Request, res: Response) => {
  const updatedUser = await userService.updateUser(req.params.id as string, req.body);
  sendSuccess(res, 200, 'User updated', updatedUser);
};

export const resetPassword = async (req: Request, res: Response) => {
  await userService.resetPassword(req.params.id as string, req.body.new_password);
  sendSuccess(res, 200, 'Password updated successfully');
};
