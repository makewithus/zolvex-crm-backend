import { PrismaClient } from '@prisma/client';
import { getAlertsSummary } from './src/services/alert.service';

const prisma = new PrismaClient();

async function runTests() {
  console.log('--- TESTING ALERTS RBAC ---');
  let failures = 0;

  try {
    // Need a Finance user and a normal user
    const financeUser = await prisma.user.findFirst({
      where: { role: { name: 'Finance' } },
      include: { role: true }
    });
    const normalUser = await prisma.user.findFirst({
      where: { role: { name: 'City Manager' } },
      include: { role: true }
    });

    if (!financeUser || !normalUser) throw new Error('Missing test users');

    // Create a submitted expense by normalUser
    const city = await prisma.city.findFirst();
    const expSub = await prisma.expense.create({
      data: {
        expense_number: 'TEST-ALERT-1',
        sequence_number: 888881,
        category: 'Travel',
        amount: 100,
        expense_date: new Date(),
        description: 'Test Submit',
        city_id: city?.id,
        created_by: normalUser.id,
        status: 'Submitted'
      }
    });

    // Create a rejected expense by normalUser
    const expRej = await prisma.expense.create({
      data: {
        expense_number: 'TEST-ALERT-2',
        sequence_number: 888882,
        category: 'Travel',
        amount: 100,
        expense_date: new Date(),
        description: 'Test Reject',
        city_id: city?.id,
        created_by: normalUser.id,
        status: 'Rejected'
      }
    });

    // Create a rejected expense by financeUser (to test isolation)
    const expRejFinance = await prisma.expense.create({
      data: {
        expense_number: 'TEST-ALERT-3',
        sequence_number: 888883,
        category: 'Travel',
        amount: 100,
        expense_date: new Date(),
        description: 'Test Reject Other',
        city_id: city?.id,
        created_by: financeUser.id,
        status: 'Rejected'
      }
    });

    // Test Finance User
    const financeAlerts = await getAlertsSummary({ id: financeUser.id, role: financeUser.role?.name || 'Finance' });
    console.log(`Finance User -> Pending: ${financeAlerts.pendingExpenses}, Rejected: ${financeAlerts.rejectedExpenses}, Total: ${financeAlerts.total}`);
    if (financeAlerts.pendingExpenses < 1) {
      console.error('❌ Finance User should see pending expenses.');
      failures++;
    }

    // Test Normal User
    const normalAlerts = await getAlertsSummary({ id: normalUser.id, role: normalUser.role?.name || 'City Manager' });
    console.log(`Normal User  -> Pending: ${normalAlerts.pendingExpenses}, Rejected: ${normalAlerts.rejectedExpenses}, Total: ${normalAlerts.total}`);
    if (normalAlerts.pendingExpenses !== 0) {
      console.error('❌ Normal User should NOT see pending expenses.');
      failures++;
    }
    if (normalAlerts.rejectedExpenses < 1) {
      console.error('❌ Normal User should see their own rejected expenses.');
      failures++;
    }

    // Existing Alerts intact
    console.log(`Existing Alerts Intact -> Complaints: ${normalAlerts.openComplaints}, Leads: ${normalAlerts.newLeads}, FollowUps: ${normalAlerts.dueFollowUps}, Invoices: ${normalAlerts.unpaidInvoices}`);

    // Cleanup
    await prisma.expense.deleteMany({ where: { expense_number: { in: ['TEST-ALERT-1', 'TEST-ALERT-2', 'TEST-ALERT-3'] } } });
    console.log('✅ Cleanup successful.');

  } catch (err: any) {
    console.error('❌ Test Failed:', err.message);
    failures++;
  }

  console.log('\n--- TESTS COMPLETED ---');
  if (failures > 0) {
    console.error(`Status: FAILED with ${failures} errors.`);
    process.exit(1);
  } else {
    console.log('Status: ALL TESTS PASSED.');
    process.exit(0);
  }
}

runTests().finally(() => prisma.$disconnect());
