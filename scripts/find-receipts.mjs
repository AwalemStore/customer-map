const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Try many possible endpoints for payment receipts
const endpoints = [
  '/enigma/receipts?limit=5&offset=0',
  '/enigma/payment-receipts?limit=5&offset=0',
  '/enigma/vouchers?limit=5&offset=0',
  '/enigma/customer-receipts?limit=5&offset=0',
  '/enigma/journal-entries?limit=5&offset=0',
  '/enigma/transactions?limit=5&offset=0',
  '/accounting/vouchers?limit=5&offset=0',
  '/accounting/journal-entries?limit=5&offset=0',
  '/accounting/receipts?limit=5&offset=0',
  '/enigma/invoices?query=Pay&limit=5&offset=0',
  '/enigma/documents?limit=5&offset=0',
  '/enigma/records?limit=5&offset=0',
  '/customer-service/receipts?limit=5&offset=0',
  '/customer-service/payments?limit=5&offset=0',
  '/reporting-bridge/payments?limit=5&offset=0',
  '/enigma/invoices?type=PaymentReceipt&limit=5&offset=0',
  '/enigma/invoices?type=receipt&limit=5&offset=0',
  '/enigma/invoices?source=Payment&limit=5&offset=0',
];

for (const ep of endpoints) {
  try {
    const r = await fetch(`${API_BASE}${ep}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    const status = r.status;
    if (status === 200) {
      const d = await r.json();
      const count = d.data?.length || d.meta?.total || d.total || '?';
      const sample = d.data?.[0] || d[0] || null;
      console.log(`✓ ${ep} → 200 | count=${count}`);
      if (sample) console.log(`  fields: ${Object.keys(sample).join(', ')}`);
      if (sample) console.log(`  sample: ${JSON.stringify(sample).substring(0, 300)}`);
    } else {
      console.log(`✗ ${ep} → ${status}`);
    }
  } catch(e) { console.log(`✗ ${ep} → ERR`); }
}

// Also check: the invoice API might have payment-type invoices with different source
console.log('\n=== Checking invoice "source" field values ===');
const invRes = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=0`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
const invData = await invRes.json();
const sources = {};
invData.data.forEach(inv => { sources[inv.source || 'NULL'] = (sources[inv.source || 'NULL'] || 0) + 1; });
console.log('Sources:', JSON.stringify(sources));

// Check if there's a payment source
const payInv = invData.data.filter(inv => inv.source === 'Payment' || inv.source === 'Receipt' || inv.invoiceNumber?.startsWith('Pay'));
console.log(`Payment-type invoices in first page: ${payInv.length}`);
if (payInv[0]) console.log(`  Sample: ${JSON.stringify(payInv[0]).substring(0, 400)}`);

// Try fetching Pay- prefixed invoices
console.log('\n=== Searching for Pay- invoices ===');
const payRes = await fetch(`${API_BASE}/enigma/invoices?query=Pay&limit=10&offset=0`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
const payData = await payRes.json();
console.log(`Pay search results: ${payData.data?.length || 0}`);
if (payData.data?.[0]) console.log(`  First: ${JSON.stringify(payData.data[0]).substring(0, 400)}`);
