import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function run() { 
  const jobs = await prisma.job.findMany(); 
  console.log(jobs.map(j => `${j.job_id} - ${j.status}`)); 
} 
run();
