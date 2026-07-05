import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function run() { 
  const user = await prisma.user.findFirst({ where: { role: { name: 'Field Staff' } } });
  const job = await prisma.job.findFirst({ where: { status: 'Pending' } });
  if (!job) return console.log('no pending job');
  if (!user) return console.log('no field staff user found');
  await prisma.job.update({ 
    where: { id: job.id }, 
    data: { status: 'Started', assigned_user_id: user.id } 
  }); 
  console.log(`Updated job ${job.id} to Started for user ${user.id}`); 
} 
run();
