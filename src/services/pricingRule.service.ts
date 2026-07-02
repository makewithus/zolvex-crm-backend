import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllPricingRules = async () => {
  return prisma.pricingRule.findMany({
    include: { service: true, city: true }
  });
};

export const createPricingRule = async (data: any) => {
  return prisma.pricingRule.create({ data });
};
