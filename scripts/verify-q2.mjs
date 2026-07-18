const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Fetch ALL Q2 invoices
let offset = 0;
const allQ2 = [];
let hasMore = true;

while (hasMore) {
  const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=${offset}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (!res.ok) break;
  const data = await res.json();
  if (!data.data || data.data.length === 0) break;

  for (const inv of data.data) {
    const d = new Date(inv.completionDate || inv.date);
    if (d.getFullYear() === 2026 && d.getMonth() >= 3 && d.getMonth() <= 5) {
      allQ2.push({
        num: inv.invoiceNumber,
        date: (inv.completionDate || inv.date).substring(0, 10),
        customer: (inv.customerName || '').trim(),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        paid: parseFloat(inv.paidAmount || 0),
        pm: inv.paymentMethod || '',
      });
    }
    if (d.getFullYear() === 2026 && d.getMonth() < 3) { hasMore = false; break; }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}

console.log(`Total Q2 invoices: ${allQ2.length}`);
console.log(`Sales: ${allQ2.filter(i => i.type === 'sale').length}`);
console.log(`Returns: ${allQ2.filter(i => i.type === 'return').length}`);

// Print EVERY invoice with payment
console.log('\n=== ALL Q2 INVOICES WITH PAYMENT (paid > 0) ===\n');
const paid = allQ2.filter(i => i.paid > 0).sort((a, b) => b.paid - a.paid);
let totalPaid = 0;
paid.forEach((inv, i) => {
  console.log(`${String(i+1).padStart(3)}. ${inv.date} | ${inv.num} | ${inv.type.padEnd(6)} | ${inv.pm.padEnd(10)} | total=${String(inv.total).padStart(8)} | paid=${String(inv.paid).padStart(8)} | ${inv.customer}`);
  totalPaid += inv.paid;
});
console.log(`\nTotal paid: ${totalPaid.toFixed(2)}`);

// Print returns
console.log('\n=== ALL Q2 RETURNS ===\n');
const returns = allQ2.filter(i => i.type === 'return');
let totalReturns = 0;
returns.forEach((inv, i) => {
  console.log(`${String(i+1).padStart(3)}. ${inv.date} | ${inv.num} | total=${String(inv.total).padStart(8)} | paid=${String(inv.paid).padStart(8)} | ${inv.customer}`);
  totalReturns += inv.total;
});
console.log(`\nTotal returns: ${totalReturns.toFixed(2)}`);

// Group by customer
console.log('\n=== PER CUSTOMER SUMMARY ===\n');
const byCustomer = {};
allQ2.forEach(inv => {
  const name = inv.customer;
  if (!byCustomer[name]) byCustomer[name] = { sales: 0, paid: 0, returns: 0, saleCount: 0, returnCount: 0, paidCount: 0, details: [] };
  if (inv.type === 'sale') {
    byCustomer[name].sales += inv.total;
    byCustomer[name].saleCount++;
    if (inv.paid > 0) { byCustomer[name].paid += inv.paid; byCustomer[name].paidCount++; }
  } else {
    byCustomer[name].returns += inv.total;
    byCustomer[name].returnCount++;
  }
  byCustomer[name].details.push(inv);
});

const customerList = Object.entries(byCustomer)
  .filter(([_, c]) => c.paid > 0)
  .sort((a, b) => b[1].paid - a[1].paid);

console.log('Customers with actual collection:');
customerList.forEach(([name, c], i) => {
  const netAfterReturn = c.paid - c.returns;
  const flag = netAfterReturn <= 0 ? ' ⚠️ NET=0 (excluded)' : '';
  console.log(`${String(i+1).padStart(3)}. ${name.substring(0, 40).padEnd(40)} | sales=${c.saleCount} returns=${c.returnCount} paidInvoices=${c.paidCount} | grossPaid=${c.paid.toFixed(2)} returns=${c.returns.toFixed(2)} net=${netAfterReturn.toFixed(2)}${flag}`);
});

console.log(`\nTotal customers with collection: ${customerList.length}`);
console.log(`Total net collected (after returns): ${customerList.reduce((s, [_, c]) => s + Math.max(0, c.paid - c.returns), 0).toFixed(2)}`);
