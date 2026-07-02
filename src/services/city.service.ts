import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllCities = async () => {
  return prisma.city.findMany({
    include: { serviceAreas: true }
  });
};

export const createCity = async (data: any) => {
  return prisma.city.create({ data });
};
