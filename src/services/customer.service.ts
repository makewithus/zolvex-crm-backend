import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

export const getAllCustomers = async () => {
  return prisma.customer.findMany({
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: { leads: true }
  });
};

export const getCustomerById = async (id: string) => {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: { leads: { include: { service: true } } }
  });
  if (!customer) throw new AppError('Customer not found', 404);
  return customer;
};

export const updateCustomer = async (id: string, data: any) => {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new AppError('Customer not found', 404);

  return prisma.customer.update({
    where: { id },
    data
  });
};
