import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

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
