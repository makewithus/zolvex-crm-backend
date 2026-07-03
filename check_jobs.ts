import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.job.findMany().then(jobs => {
  console.log(JSON.stringify(jobs.map(j => ({ id: j.id, start: j.scheduled_start, status: j.status, assigned: j.assigned_user_id })), null, 2));
  prisma.$disconnect();
});
