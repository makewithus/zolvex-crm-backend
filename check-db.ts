import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkDb() {
  console.log('🔍 Checking Database State...\n');
  try {
    // Check Complaints
    const complaintsCount = await prisma.complaint.count();
    console.log(`✅ Complaint table exists (Count: ${complaintsCount})`);

    // Check Feedback
    const feedbackCount = await prisma.customerFeedback.count();
    console.log(`✅ CustomerFeedback table exists (Count: ${feedbackCount})`);

    // Check Core Integrity (Leads & Jobs)
    const leadsCount = await prisma.lead.count();
    const jobsCount = await prisma.job.count();
    console.log(`✅ Core tables intact (Leads: ${leadsCount}, Jobs: ${jobsCount})`);

  } catch (error: any) {
    console.error('❌ Database check failed:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkDb();
