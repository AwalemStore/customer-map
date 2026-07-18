const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;
console.log('✓ Authenticated\n');

// Fetch ALL Q2 invoices and look for specific customers
let offset = 0;
const limit = 50;
let hasMore = true;
const targets = ['الصالحية', 'الاقتصادي'];

console.log('=== Searching for target customers in Q2 invoices ===\n');

while (hasMore) {
  const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=${limit}&offset=${offset}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (!res.ok) break;
  const data = await res.json();
  if (!data.data || data.data.length === 0) break;

  for (const inv of data.data) {
    const d = new Date(inv.completionDate || inv.date || inv.createdAt);
    if (d.getFullYear() !== 2026 || d.getMonth() < 3 || d.getMonth() > 5) {
      if (d.getFullYear() === 2026 && d.getMonth() < 3) { hasMore = false; break; }
      continue;
    }
    
    const name = (inv.customerName || '').trim();
    for (const target of targets) {
      if (name.includes(target)) {
        console.log(`FOUND: ${name}`);
        console.log(`  Invoice: ${inv.invoiceNumber}`);
        console.log(`  Date: ${(inv.completionDate || inv.date).substring(0,10)}`);
        console.log(`  Total: ${inv.total}`);
        console.log(`  PaidAmount: ${inv.paidAmount}`);
        console.log(`  PaymentMethod: ${inv.paymentMethod}`);
        console.log(`  Type: ${inv.type}`);
        console.log(`  isReturn: ${inv.isReturn}`);
        console.log(`  All fields: ${Object.keys(inv).join(', ')}`);
        console.log('');
      }
    }
  }
  offset += limit;
  if (data.data.length < limit) hasMore = false;
}

// Also check customer data
console.log('\n=== Customer records ===');
for (let o = 0; o < 700; o += 50) {
  const res = await fetch(`${API_BASE}/enigma/customers?query=&limit=50&offset=${o}&customFields=[]`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.data) break;
  for (const c of data.data) {
    for (const target of targets) {
      if ((c.name || '').includes(target)) {
        console.log(`Customer: ${c.name}`);
        console.log(`  totalPaid: ${c.totalPaid}`);
        console.log(`  debitAmount: ${c.debitAmount}`);
        console.log('');
      }
    }
  }
  if (data.data.length < 50) break;
}
