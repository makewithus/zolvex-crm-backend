import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllServices = async () => {
  return prisma.service.findMany();
};

export const createService = async (data: any) => {
  return prisma.service.create({ data });
};
