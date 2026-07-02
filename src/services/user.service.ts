import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const getAllUsers = async (roleName: string, cityId?: string) => {
  const where = roleName === 'City Manager' && cityId ? { city_id: cityId } : {};
  return prisma.user.findMany({
    where,
    select: { id: true, name: true, phone: true, is_active: true, joining_date: true, skill_tags: true, role: true, city: true }
  });
};

export const createUser = async (userData: any, passwordRaw: string) => {
  const password_hash = await bcrypt.hash(passwordRaw, 10);
  return prisma.user.create({
    data: { ...userData, password_hash }
  });
};

export const updateUser = async (id: string, data: any) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);
  return prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, phone: true, is_active: true, joining_date: true, skill_tags: true, role: true, city: true }
  });
};

export const resetPassword = async (id: string, newPasswordRaw: string) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);
  const password_hash = await bcrypt.hash(newPasswordRaw, 10);
  await prisma.user.update({
    where: { id },
    data: { password_hash }
  });
  return true;
};
