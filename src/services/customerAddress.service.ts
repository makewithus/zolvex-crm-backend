import { PrismaClient } from '@prisma/client';
import { AppError } from '../utils/AppError';

const prisma = new PrismaClient();

// ── Customer Addresses ─────────────────────────────────────────────────────

export const getCustomerAddresses = async (customer_id: string) => {
  return prisma.customerAddress.findMany({
    where: { customer_id },
    orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }]
  });
};

export const createCustomerAddress = async (
  customer_id: string,
  data: { label: string; address: string; city?: string; pincode?: string; is_default?: boolean }
) => {
  // If this is set as default, clear existing default first
  if (data.is_default) {
    await prisma.customerAddress.updateMany({
      where: { customer_id, is_default: true },
      data: { is_default: false }
    });
  }

  return prisma.customerAddress.create({
    data: { customer_id, ...data }
  });
};

export const updateCustomerAddress = async (
  id: string,
  customer_id: string,
  data: { label?: string; address?: string; city?: string; pincode?: string; is_default?: boolean }
) => {
  const existing = await prisma.customerAddress.findFirst({ where: { id, customer_id } });
  if (!existing) throw new AppError('Address not found', 404);

  if (data.is_default) {
    await prisma.customerAddress.updateMany({
      where: { customer_id, is_default: true },
      data: { is_default: false }
    });
  }

  return prisma.customerAddress.update({ where: { id }, data });
};

export const deleteCustomerAddress = async (id: string, customer_id: string) => {
  const existing = await prisma.customerAddress.findFirst({ where: { id, customer_id } });
  if (!existing) throw new AppError('Address not found', 404);
  return prisma.customerAddress.delete({ where: { id } });
};
