import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllRoles = async () => {
  return prisma.role.findMany();
};
