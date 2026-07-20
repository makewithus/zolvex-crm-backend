import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export const generateToken = (payload: object) => {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
};

export const verifyToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET);
};
