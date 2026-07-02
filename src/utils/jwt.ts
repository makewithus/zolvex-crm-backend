import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const generateToken = (payload: object, expiresIn: string = '1d') => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: expiresIn as any });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET);
};
