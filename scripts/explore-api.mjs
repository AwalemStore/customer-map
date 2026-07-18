const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

// Auth
const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
  },
  body: JSON.stringify({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD },
  }),
});
const authData = await authRes.json();
const token = authData.AuthenticationResult?.IdToken;
if (!token) { console.log('Auth failed'); process.exit(1); }
console.log('✓ Authenticated');

// Try different payment/invoice endpoints
const endpoints = [
  '/enigma/payments?offset=0&limit=10',
  '/enigma/receipts?offset=0&limit=10',
  '/enigma/customer-payments?offset=0&limit=10',
  '/enigma/invoices?offset=0&limit=10',
  '/enigma/invoices?query=&limit=10&offset=0',
  '/reporting-bridge/invoices?limit=10&offset=0',
  '/enigma/invoices/list?limit=10&offset=0',
  '/enigma/invoices/search?limit=10&offset=0',
];

for (const ep of endpoints) {
  try {
    const res = await fetch(API_BASE + ep, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    const status = res.status;
    if (status === 200) {
      const data = await res.json();
      const keys = Object.keys(data);
      const firstItem = data.data?.[0] || data.resultSet?.[0] || data[0] || null;
      console.log(`✓ ${ep} → ${status} | keys: ${keys.join(',')} | sample fields: ${firstItem ? Object.keys(firstItem).join(',') : 'N/A'}`);
    } else {
      console.log(`✗ ${ep} → ${status}`);
    }
  } catch (e) {
    console.log(`✗ ${ep} → ERROR: ${e.message}`);
  }
}

// Try the original invoices endpoint with different params
const params = [
  '?offset=0&limit=10',
  '?offset=0&limit=10&query=',
  '?offset=0&limit=10&sortOn=date&sortBy=DESC',
  '?offset=0&limit=10&filter={"type":"sale"}',
];
for (const p of params) {
  try {
    const res = await fetch(`${API_BASE}/enigma/invoices/latest${p}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    if (res.status === 200) {
      const data = await res.json();
      console.log(`✓ /enigma/invoices/latest${p} → 200 | items: ${data.data?.length || 0}`);
      if (data.data?.[0]) console.log(`  Sample: ${JSON.stringify(data.data[0]).substring(0, 500)}`);
    } else {
      const text = await res.text();
      console.log(`✗ /enigma/invoices/latest${p} → ${res.status} | ${text.substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`✗ /enigma/invoices/latest${p} → ${e.message}`);
  }
}

// Try customer ledger / statement
const ledgerEndpoints = [
  '/enigma/customers/1/ledger?limit=10',
  '/enigma/customers/1/payments?limit=10',
  '/enigma/customers/1/invoices?limit=10',
  '/enigma/customers/1/transactions?limit=10',
];
for (const ep of ledgerEndpoints) {
  try {
    const res = await fetch(API_BASE + ep, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    if (res.status === 200) {
      const data = await res.json();
      console.log(`✓ ${ep} → 200 | ${JSON.stringify(data).substring(0, 300)}`);
    } else {
      console.log(`✗ ${ep} → ${res.status}`);
    }
  } catch (e) {
    console.log(`✗ ${ep} → ${e.message}`);
  }
}
