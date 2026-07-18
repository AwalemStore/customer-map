const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Try various payment-related endpoints
const endpoints = [
  '/enigma/customer-payments',
  '/enigma/customer-ledger',
  '/reporting-bridge/dashboard/payment-methods-report?startDate=2026-07-17T21:00:00.000Z&endDate=2026-07-18T20:59:59.999Z&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59',
  '/reporting-bridge/transactions?limit=10&offset=0',
  '/enigma/transactions?limit=10&offset=0',
  '/accounting/transactions?limit=10&offset=0',
];

for (const ep of endpoints) {
  try {
    const r = await fetch(`${API_BASE}${ep}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    const status = r.status;
    if (status === 200) {
      const d = await r.json();
      const str = JSON.stringify(d).substring(0, 500);
      console.log(`✓ ${ep.substring(0,60)}: 200`);
      console.log(`  ${str}`);
    } else {
      console.log(`✗ ${ep.substring(0,60)}: ${status}`);
    }
  } catch(e) { console.log(`✗ ${ep.substring(0,60)}: ${e.message}`); }
}

// Get today's payment methods report specifically
console.log('\n=== TODAY PAYMENT METHODS REPORT ===');
const todayStart = '2026-07-17T21:00:00.000Z';
const todayEnd = '2026-07-18T20:59:59.999Z';
const pmRes = await fetch(`${API_BASE}/reporting-bridge/dashboard/payment-methods-report?startDate=${todayStart}&endDate=${todayEnd}&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
if (pmRes.ok) {
  const pmData = await pmRes.json();
  console.log(JSON.stringify(pmData, null, 2));
}
