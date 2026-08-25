import { createLead, getLeadById, createLeadNote } from '../src/services/lead.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  try {
    // We need a valid user ID for "created_by"
    const user = await prisma.user.findFirst();
    if (!user) throw new Error("No users found");

    const phone = '98765' + Math.floor(Math.random() * 99999).toString().padStart(5, '0');
    console.log(`\n--- 1. Creating WhatsApp Lead with phone: ${phone} ---`);
    
    // Simulate what the controller receives
    const payload = {
      phone,
      name: 'Test WhatsApp Lead',
      source: 'WhatsApp'
    };

    const lead = await createLead(payload, user.id);
    console.log(`Lead Created! ID: ${lead.id}, Status: ${lead.status}`);

    console.log(`\n--- 2. Fetching from DB immediately ---`);
    const fetchedLead = await getLeadById(lead.id);
    console.log(`Status in DB: ${fetchedLead.status}`);

    console.log(`\n--- 3. Adding a Note ---`);
    await createLeadNote(lead.id, 'User copy-pasted a WhatsApp message here', user.id);
    
    console.log(`\n--- 4. Fetching from DB after Note ---`);
    const leadAfterNote = await getLeadById(lead.id);
    console.log(`Status in DB after Note: ${leadAfterNote.status}`);

  } catch (err: any) {
    console.error("ERROR:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}
run();
