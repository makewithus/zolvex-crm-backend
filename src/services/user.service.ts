import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const getAllUsers = async (roleName: string, cityId?: string) => {
  const where = roleName === 'City Manager' && cityId ? { city_id: cityId } : {};
  return prisma.user.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: { id: true, name: true, phone: true, is_active: true, joining_date: true, skill_tags: true, role: true, city: true }
  });
};

export const getUserById = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, phone: true, is_active: true, joining_date: true, skill_tags: true, city_id: true, role: { select: { name: true } }, city: true }
  });
  if (!user) throw new AppError('User not found', 404);
  if (!user.is_active) throw new AppError('Account has been deactivated', 401);
  return user;
};

export const createUser = async (userData: any, passwordRaw: string) => {
  const password_hash = await bcrypt.hash(passwordRaw, 10);
  // Sanitise optional FK: empty string "" must become null, not a FK lookup
  const sanitised = {
    ...userData,
    city_id: userData.city_id || null,
  };
  return prisma.user.create({
    data: { ...sanitised, password_hash }
  });
};

export const updateUser = async (id: string, data: any) => {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);
  
  // Sanitise optional FK: empty string "" must become null, not a FK lookup
  const sanitised = { ...data };
  if ('city_id' in sanitised) {
    sanitised.city_id = sanitised.city_id || null;
  }
  
  return prisma.user.update({
    where: { id },
    data: sanitised,
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
