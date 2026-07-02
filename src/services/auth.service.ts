import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { generateToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const loginUser = async (phone: string, password: string) => {
  const user = await prisma.user.findUnique({
    where: { phone },
    include: { role: true },
  });

  if (!user || !user.is_active) {
    throw new AppError('Invalid credentials or inactive account', 401);
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    throw new AppError('Invalid credentials', 401);
  }

  const token = generateToken({ id: user.id, role: user.role.name, cityId: user.city_id || undefined });
  const { password_hash, ...userWithoutPassword } = user;

  return { token, user: userWithoutPassword };
};
