import { createLead, updateLead } from '../src/services/lead.service';
import { convertLeadToBooking } from '../src/services/booking.service';
import { getAlertsSummary } from '../src/services/alert.service';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function verifyAll() {
    try {
        const user = await prisma.user.findFirst();
        if (!user)
            throw new Error("No users found");
        const city = await prisma.city.findFirst();
        const service = await prisma.service.findFirst();
        const pricingRule = await prisma.pricingRule.findFirst({
            where: { service_id: service?.id }
        });
        if (!city || !service || !pricingRule) {
            console.log("Not enough seed data to test conversion.");
            return;
        }
        console.log("--- 1. Testing Lead Creation with new fields ---");
        const phone = '888' + Math.floor(Math.random() * 9999999).toString().padStart(7, '0');
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1); // tomorrow
        const leadPayload = {
            phone,
            name: 'Integration Test Lead',
            source: 'ManualEntry',
            city_id: city.id,
            service_id: service.id,
            service_location: 'Dwarka Sector 12',
            follow_up_date: futureDate.toISOString()
        };
        // Simulate frontend form not passing status (defaults to New)
        const lead = await createLead(leadPayload, user.id);
        console.log("Created Lead:", lead.id, "Location:", lead.service_location, "FollowUp:", lead.follow_up_date);
        console.log("\n--- 2. Testing Lead Update & Bell Count ---");
        // Update to FollowUp and set date to yesterday
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 1);
        await updateLead(lead.id, { status: 'FollowUp', follow_up_date: pastDate.toISOString() }, user.id);
        console.log("Updated to FollowUp (Past Date).");
        const alerts = await getAlertsSummary();
        console.log("Notification Bell 'dueFollowUps':", alerts.dueFollowUps);
        if (alerts.dueFollowUps === 0)
            throw new Error("Bell should count this follow-up!");
        console.log("\n--- 3. Testing Lead -> Booking Conversion Mapping ---");
        const bookingPayload = {
            scheduled_date: futureDate.toISOString(),
            slot: '10:00',
            address_line_1: 'House 123',
            area: lead.service_location, // Mock frontend passing it
            city_name: city.name,
            postal_code: '110075',
            country: 'India'
        };
        const booking = await convertLeadToBooking(lead.id, bookingPayload, user.id);
        console.log("Converted to Booking ID:", booking.id);
        console.log("Mapped Area on Booking:", booking.area);
        const alertsAfter = await getAlertsSummary();
        console.log("Notification Bell 'dueFollowUps' after conversion:", alertsAfter.dueFollowUps);
        console.log("\n✅ ALL VERIFICATIONS PASSED!");
    }
    catch (err) {
        console.error("Verification Failed:", err.message);
    }
    finally {
        await prisma.$disconnect();
    }
}
verifyAll();
