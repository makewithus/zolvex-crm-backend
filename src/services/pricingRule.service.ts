import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const getAllPricingRules = async (filters: any = {}) => {
  const where: any = {};
  if (filters.service_id) where.service_id = filters.service_id;
  if (filters.city_id) {
    where.OR = [
      { city_id: filters.city_id },
      { city_id: null }
    ];
  }
  return prisma.pricingRule.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: { service: true, city: true }
  });
};

export const createPricingRule = async (data: any) => {
  return prisma.pricingRule.create({ data });
};

export const updatePricingRule = async (id: string, data: any) => {
  const rule = await prisma.pricingRule.findUnique({ where: { id } });
  if (!rule) throw new AppError('Pricing rule not found', 404);
  return prisma.pricingRule.update({
    where: { id },
    data
  });
};

export const deletePricingRule = async (id: string) => {
  const rule = await prisma.pricingRule.findUnique({ where: { id } });
  if (!rule) throw new AppError('Pricing rule not found', 404);
  return prisma.pricingRule.delete({
    where: { id }
  });
};
