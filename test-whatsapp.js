const crypto = require('crypto');

async function testWhatsAppWebhook() {
  const PORT = 5000;
  const BASE_URL = `http://localhost:${PORT}/api/v1/whatsapp-webhook`;
  const VERIFY_TOKEN = 'zolvex_crm_secure_webhook_token_2026';
  
  // 1. Test GET Verification
  console.log('\n--- 1. Testing Meta Webhook Verification (GET) ---');
  const getUrl = `${BASE_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=CHALLENGE_ACCEPTED`;
  
  try {
    const getRes = await fetch(getUrl);
    const getText = await getRes.text();
    console.log(`Status: ${getRes.status}`);
    console.log(`Response: ${getText}`);
    if (getRes.status === 200 && getText === 'CHALLENGE_ACCEPTED') {
      console.log('✅ GET Verification passed!');
    } else {
      console.log('❌ GET Verification failed.');
    }
  } catch (err) {
    console.error('❌ Could not connect to the server. Is the backend running on port 5000?');
    return;
  }

  // 2. Test POST Incoming Message
  console.log('\n--- 2. Testing Incoming WhatsApp Message (POST) ---');
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '1363004662638381',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '1234567890',
                phone_number_id: '1195908633611902'
              },
              contacts: [
                {
                  profile: { name: 'Test User' },
                  wa_id: '919876543210'
                }
              ],
              messages: [
                {
                  from: '919876543210',
                  id: 'wamid.HBgLOTkxNzYzODIyMTkVAgASGCQ5MDZGNUI1QTMxOUEyQTNGOEM3RDJGNTJEMTEyQTU2OQA=',
                  timestamp: '1690000000',
                  text: { body: 'Hello CRM, this is a test lead from WhatsApp!' },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };

  const payloadString = JSON.stringify(payload);
  const APP_SECRET = 'TODO_FILL_IN_YOUR_APP_SECRET'; // Default secret from .env

  // Compute HMAC signature exactly as Meta does
  const hmac = crypto.createHmac('sha256', APP_SECRET);
  const signature = 'sha256=' + hmac.update(payloadString).digest('hex');

  try {
    const postRes = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature
      },
      body: payloadString
    });

    console.log(`Status: ${postRes.status}`);
    if (postRes.status === 200) {
      console.log('✅ POST Request accepted! Check your backend terminal logs to see if the lead was created.');
    } else {
      console.log('❌ POST Request failed.');
    }
  } catch (err) {
    console.error('❌ Failed to send POST request:', err);
  }
}

testWhatsAppWebhook();
