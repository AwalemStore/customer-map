const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Get today's invoices
const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=0`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
const data = await res.json();

console.log('=== TODAY INVOICES (all payment methods) ===');
const pmCounts = {};
data.data.forEach(inv => {
  const pm = inv.paymentMethod || 'NULL';
  pmCounts[pm] = (pmCounts[pm] || 0) + 1;
  console.log(`${inv.invoiceNumber} | ${inv.customerName?.substring(0,20)} | type=${inv.isReturn?'return':'sale'} | pm=${pm} | total=${inv.total} | paid=${inv.paidAmount}`);
});
console.log('\nPM counts:', JSON.stringify(pmCounts));

// Also try fetching with a payments-specific endpoint
const endpoints = [
  '/enigma/customer-payments?limit=10&offset=0',
  '/enigma/payments?limit=10&offset=0',
  '/enigma/receipts?limit=10&offset=0',
  '/customer-service/payments?limit=10&offset=0',
  '/payments?limit=10&offset=0',
];
for (const ep of endpoints) {
  try {
    const r = await fetch(`${API_BASE}${ep}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    console.log(`${ep}: ${r.status}`);
    if (r.ok) {
      const d = await r.json();
      console.log(`  keys: ${Object.keys(d).join(',')}`);
      if (d.data?.[0]) console.log(`  sample: ${JSON.stringify(d.data[0]).substring(0, 300)}`);
    }
  } catch(e) { console.log(`${ep}: ERROR`); }
}
