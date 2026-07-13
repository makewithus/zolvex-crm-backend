import axios from 'axios';

async function testApi() {
  try {
    console.log('1. Logging in...');
    // In dev environments, there is usually a default super admin. Let's try 9999999999 / Password@123 or similar if we can't find it, we'll check the DB.
    // Wait, let's just bypass by using the check-db script to generate a JWT or let's find a user from the DB.
  } catch(e) {
    // console.error(e.response?.data || e.message);
  }
}

testApi();
