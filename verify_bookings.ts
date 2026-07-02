import { PrismaClient } from '@prisma/client';
import * as bookingService from './src/services/booking.service';
import * as leadService from './src/services/lead.service';

const prisma = new PrismaClient();

async function runTests() {
  console.log("Starting Booking Module Verification...");
  
  // 1. Setup Test Data
  let role = await prisma.role.findFirst({ where: { name: 'Super Admin' } });
  if (!role) {
     role = await prisma.role.create({ data: { name: 'Super Admin', permissions: [] }});
  }

  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: 'test@zolvex.com',
        password_hash: 'hash',
        name: 'Test Admin',
        phone: '1234567890',
        role_id: role.id
      }
    });
  }

  let city = await prisma.city.findFirst();
  if (!city) {
    city = await prisma.city.create({ data: { name: 'Test City', code: 'TC', is_active: true } });
  }

  let service = await prisma.service.findFirst();
  if (!service) {
    service = await prisma.service.create({
      data: { name: 'Test Service', description: 'Test', is_active: true, base_price: 199.95 }
    });
  }

  let pricingRule = await prisma.pricingRule.findFirst();
  if (!pricingRule) {
    pricingRule = await prisma.pricingRule.create({
      data: { city_id: city.id, service_id: service.id, base_price: 199.95, is_active: true }
    });
  } else {
    await prisma.pricingRule.update({ where: { id: pricingRule.id }, data: { base_price: 199.95 } });
  }

  let customer = await prisma.customer.findFirst();
  if (!customer) {
    customer = await prisma.customer.create({
      data: { name: 'John Doe', phone: '9876543210' }
    });
  }

  let lead = await prisma.lead.create({
    data: {
      name: 'Jane Doe',
      phone: '1122334455',
      source: 'WebsiteForm',
      status: 'New',
      city_id: city.id,
      service_id: service.id,
      customer_id: customer.id
    }
  });

  // --- 2. Booking Number Sequence & Concurrency ---
  console.log("\n--- Testing Booking Sequence (Concurrency) ---");
  const p1 = bookingService.createBooking({
    customer_id: customer.id,
    city_id: city.id,
    service_id: service.id,
    scheduled_date: new Date().toISOString(),
    address_line_1: '123 Main St',
    city_name: city.name,
    postal_code: '123456',
    state: 'State'
  }, user.id);
  
  const p2 = bookingService.createBooking({
    customer_id: customer.id,
    city_id: city.id,
    service_id: service.id,
    scheduled_date: new Date(Date.now() + 86400000).toISOString(),
    address_line_1: '123 Main St',
    city_name: city.name,
    postal_code: '123456',
    state: 'State'
  }, user.id);

  const [b1, b2] = await Promise.all([p1, p2]);
  console.log("Concurrent Bookings Created:", b1.booking_id, b2.booking_id);
  if (b1.booking_id === b2.booking_id) throw new Error("Duplicate IDs generated!");

  // --- 3. Pricing Snapshot Immutability ---
  console.log("\n--- Testing Pricing Snapshot ---");
  console.log("Original Booking Base Price:", b1.base_price.toString());
  await prisma.pricingRule.update({ where: { id: pricingRule.id }, data: { base_price: 299.95 } });
  const b1_after = await prisma.booking.findUnique({ where: { id: b1.id } });
  console.log("Booking Base Price after Master Price Change:", b1_after!.base_price.toString());
  if (b1.base_price.toString() !== b1_after!.base_price.toString()) throw new Error("Pricing mutated!");
  await prisma.pricingRule.update({ where: { id: pricingRule.id }, data: { base_price: 199.95 } }); // reset

  // --- 4. Customer Snapshot Immutability ---
  console.log("\n--- Testing Customer Snapshot ---");
  console.log("Original Booking Customer Name:", b1.customer_name);
  await prisma.customer.update({ where: { id: customer.id }, data: { name: 'John Doe Changed' } });
  const b1_after_cust = await prisma.booking.findUnique({ where: { id: b1.id } });
  console.log("Booking Customer Name after Master Cust Change:", b1_after_cust!.customer_name);
  if (b1.customer_name !== b1_after_cust!.customer_name) throw new Error("Customer mutated!");

  // --- 5. Lead Conversion ---
  console.log("\n--- Testing Lead Conversion ---");
  const b3 = await bookingService.convertLeadToBooking(lead.id, {
    scheduled_date: new Date().toISOString(),
    address_line_1: 'Lead St',
    city_name: city.name,
    postal_code: '123456',
    state: 'State'
  }, user.id);
  console.log("Lead converted to Booking:", b3.booking_id);
  const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id }});
  console.log("Lead Status after conversion:", updatedLead!.status);
  try {
    await bookingService.convertLeadToBooking(lead.id, {
      scheduled_date: new Date().toISOString(),
      address_line_1: 'Lead St',
      city_name: city.name,
      postal_code: '123456',
      state: 'State'
    }, user.id);
    throw new Error("Allowed duplicate conversion!");
  } catch (e: any) {
    console.log("Expected failure on second conversion:", e.message);
  }

  // --- 6. Status Machine & 7. History ---
  console.log("\n--- Testing Status Machine & History ---");
  await bookingService.updateBookingStatus(b1.id, 'Confirmed', user.id);
  await bookingService.updateBookingStatus(b1.id, 'Scheduled', user.id);
  try {
    await bookingService.updateBookingStatus(b1.id, 'Completed', user.id);
    throw new Error("Allowed Scheduled -> Completed transition!");
  } catch(e: any) {
    console.log("Expected failure for invalid transition:", e.message);
  }
  const history = await prisma.bookingHistory.findMany({ where: { booking_id: b1.id }, orderBy: { changed_at: 'asc' }});
  history.forEach(h => console.log(`History Log: [${h.from_status}] -> [${h.to_status}] at ${h.changed_at}`));

  // --- 8. Reschedule ---
  console.log("\n--- Testing Reschedule ---");
  const newDate = new Date(Date.now() + 172800000).toISOString();
  await bookingService.rescheduleBooking(b1.id, { scheduled_date: newDate, slot: 'Morning' }, user.id);
  const b1_rescheduled = await prisma.booking.findUnique({ where: { id: b1.id } });
  console.log("Booking Date Rescheduled:", b1_rescheduled!.scheduled_date);

  // --- 9. Cancel ---
  console.log("\n--- Testing Cancel ---");
  await bookingService.cancelBooking(b1.id, "Customer requested", user.id);
  const b1_cancelled = await prisma.booking.findUnique({ where: { id: b1.id } });
  console.log("Booking Status after Cancel:", b1_cancelled!.status, "Reason:", b1_cancelled!.cancel_reason);
  try {
    await bookingService.cancelBooking(b1.id, "Second cancel", user.id);
    throw new Error("Allowed canceling a cancelled booking!");
  } catch (e: any) {
    console.log("Expected failure for double cancel:", e.message);
  }

  console.log("\n--- Verification Completed Successfully! ---");
}

runTests().catch(console.error).finally(() => prisma.$disconnect());
