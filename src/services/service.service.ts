import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const getAllServices = async () => {
  return prisma.service.findMany({
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }]
  });
};

export const createService = async (data: any) => {
  return prisma.service.create({ data });
};

export const updateService = async (id: string, data: any) => {
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) throw new AppError('Service not found', 404);
  return prisma.service.update({
    where: { id },
    data
  });
};
