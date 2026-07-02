import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllLostReasons = async () => {
  return prisma.lostReason.findMany();
};

export const createLostReason = async (data: any) => {
  return prisma.lostReason.create({ data });
};
