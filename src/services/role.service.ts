import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllRoles = async () => {
  return prisma.role.findMany({
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: {
      _count: {
        select: { users: true }
      }
    }
  });
};
