import { Request, Response } from 'express';
import * as roleService from '../services/role.service';
import { sendSuccess } from '../utils/response.util';

export const getRoles = async (req: Request, res: Response) => {
  const roles = await roleService.getAllRoles();
  sendSuccess(res, 200, 'Roles retrieved', roles);
};
