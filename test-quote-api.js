const axios = require('axios');

async function run() {
  try {
    // Login
    const loginRes = await axios.post('http://localhost:5000/api/v1/auth/login', {
      phone: '9999999999', // Super Admin
      password: 'password123'
    });
    const token = loginRes.data.data.token;
    console.log('Logged in.');

    // Attempt quote creation using the same payload
    const payload = {
      customer_id: "1d1c6915-4a46-45ff-99a4-dabb305afa0a",
      subject: "AC Service",
      description: "",
      valid_until: "2026-08-27",
      notes: "",
      line_items: [
        {
          description: "ac gas",
          quantity: 1,
          unit_price: 100,
          tax_percent: 18,
          sort_order: 0
        }
      ]
    };

    console.log('Sending payload:', JSON.stringify(payload, null, 2));

    const quoteRes = await axios.post('http://localhost:5000/api/v1/quotes', payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('Success:', quoteRes.data);
  } catch (err) {
    if (err.response) {
      console.log('Failed with status:', err.response.status);
      console.log('Response body:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.log('Error:', err.message);
    }
  }
}

run();
