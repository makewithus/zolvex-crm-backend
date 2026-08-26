import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  // 1. Rename services
  const serviceMap: Record<string, string> = {
    'delivery': 'Sofa Cleaning',
    'OCC Service': 'Deep Cleaning',
    'Regression Service': 'Bathroom Cleaning',
    'sales': 'Kitchen Cleaning',
    'payment': 'Pest Control',
    'deploy': 'AC Servicing',
    'CLEAN': 'Carpet Cleaning',
    'cleaning': 'Water Tank Cleaning',
    'house service ': 'Full House Cleaning'
  };

  const services = await prisma.service.findMany();
  for (const service of services) {
    if (serviceMap[service.name]) {
      await prisma.service.update({
        where: { id: service.id },
        data: { name: serviceMap[service.name] }
      });
      console.log(`Renamed service: ${service.name} -> ${serviceMap[service.name]}`);
    }
  }

  // 2. Delete dummy cities
  const cities = await prisma.city.findMany();
  for (const city of cities) {
    const isDummy = city.name.startsWith('City1-') || 
                    city.name.startsWith('City2-') || 
                    city.name === 'Regression City' || 
                    city.name === 'OCC City' || 
                    city.name === 'Other City';
    
    if (isDummy) {
      try {
        await prisma.city.delete({ where: { id: city.id } });
        console.log(`Deleted dummy city: ${city.name}`);
      } catch (e) {
        console.log(`Could not delete dummy city: ${city.name} (likely has relations)`);
      }
    }
  }

  // 3. Ensure 'kashmir' is actually disabled in DB
  const kashmir = await prisma.city.findFirst({ where: { name: 'kashmir' } });
  if (kashmir && kashmir.is_active) {
    await prisma.city.update({
      where: { id: kashmir.id },
      data: { is_active: false }
    });
    console.log(`Disabled kashmir in DB.`);
  }

}

run().finally(() => prisma.$disconnect());
