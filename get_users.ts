import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function run() { 
  const users = await prisma.user.findMany({ include: { role: true } }); 
  console.log(users.map(u => `${u.phone} - ${u.role.name}`)); 
} 
run();
