import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const getAllCities = async () => {
  return prisma.city.findMany({
    include: { serviceAreas: true }
  });
};

export const createCity = async (data: any) => {
  return prisma.city.create({ data });
};

export const updateCity = async (id: string, data: any) => {
  const city = await prisma.city.findUnique({ where: { id } });
  if (!city) throw new AppError('City not found', 404);
  return prisma.city.update({
    where: { id },
    data
  });
};
