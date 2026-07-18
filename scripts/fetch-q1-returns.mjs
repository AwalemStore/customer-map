import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;
console.log('✓ Authenticated');

// Fetch ALL invoices Jan-Jul 2026
let offset = 0;
const allInvoices = [];
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
    if (d.getFullYear() === 2026 && d.getMonth() <= 6) {
      allInvoices.push({
        id: inv.id,
        num: inv.invoiceNumber,
        date: (inv.completionDate || inv.date).substring(0, 10),
        customer: (inv.customerName || '').trim(),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        paid: parseFloat(inv.paidAmount || 0),
        pm: inv.paymentMethod || '',
        month: d.getMonth(),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
  console.log(`  Fetched ${offset}, total: ${allInvoices.length}`);
}

// Q1 sales = Jan(0) to Mar(2)
const q1Sales = allInvoices.filter(i => i.type === 'sale' && i.month >= 0 && i.month <= 2);
// All returns after Q1 = Apr(3) onwards
const laterReturns = allInvoices.filter(i => i.type === 'return' && i.month >= 3);

console.log(`\nQ1 Sales (Jan-Mar): ${q1Sales.length}`);
console.log(`Returns after Q1 (Apr+): ${laterReturns.length}`);

// Build Q1 sales index by customer
const q1ByCustomer = {};
q1Sales.forEach(s => {
  const key = s.customer;
  if (!q1ByCustomer[key]) q1ByCustomer[key] = [];
  q1ByCustomer[key].push(s);
});

// For each return, find the ORIGINAL sale it belongs to
// Logic: same customer + same date (or within 1 day) + same amount = linked
const matchedReturns = [];

laterReturns.forEach(r => {
  const customerSales = q1ByCustomer[r.customer] || [];
  if (customerSales.length === 0) {
    console.log(`  ✗ ${r.customer.substring(0,30)} | no Q1 sales`);
    return;
  }

  // Find the sale that matches this return
  // Priority: same date + same amount, then same amount only
  let matched = customerSales.find(s => s.date === r.date && s.total === r.total);
  if (!matched) matched = customerSales.find(s => s.total === r.total);
  if (!matched) matched = customerSales.find(s => Math.abs(s.total - r.total) < 1);

  if (matched) {
    matchedReturns.push({
      returnInvoice: r.num,
      returnDate: r.date,
      returnAmount: r.total,
      customer: r.customer,
      originalSaleInvoice: matched.num,
      originalSaleDate: matched.date,
      originalSaleAmount: matched.total,
    });
    console.log(`  ✓ ${r.customer.substring(0,30)} | ${r.num} → ${matched.num} Q1 (${matched.date}) = ${r.total}`);
  } else {
    // The return customer had Q1 sales, but amounts don't match → the return is for a Q2 sale
    console.log(`  ✗ ${r.customer.substring(0,30)} | return ${r.total} doesn't match any Q1 sale amount`);
  }
});

console.log(`\nMatched Q1 returns: ${matchedReturns.length}`);
console.log(`Total return amount: ${matchedReturns.reduce((s, r) => s + r.returnAmount, 0).toFixed(2)}`);
console.log(`VAT deduction (15%): ${(matchedReturns.reduce((s, r) => s + r.returnAmount, 0) * 15 / 115).toFixed(2)}`);

const returnData = {
  count: matchedReturns.length,
  totalReturns: +matchedReturns.reduce((s, r) => s + r.returnAmount, 0).toFixed(2),
  vatDeduction: +(matchedReturns.reduce((s, r) => s + r.returnAmount, 0) * 15 / 115).toFixed(2),
  netDeduction: +(matchedReturns.reduce((s, r) => s + r.returnAmount, 0) * 100 / 115).toFixed(2),
  returns: matchedReturns.map(r => ({
    customer: r.customer,
    returnInvoice: r.returnInvoice,
    returnDate: r.returnDate,
    returnAmount: +r.returnAmount.toFixed(2),
    vat: +(r.returnAmount * 15 / 115).toFixed(2),
    net: +(r.returnAmount * 100 / 115).toFixed(2),
    originalSaleInvoice: r.originalSaleInvoice,
    originalSaleDate: r.originalSaleDate,
    originalSaleAmount: +r.originalSaleAmount.toFixed(2),
  })),
};

const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst Q1_RETURNS_DATA = .*?;\n/g, '\n');
const idx = html.indexOf('// ===== Q1 RETURNS');
if (idx > -1) {
  html = html.substring(0, idx) + `\nconst Q1_RETURNS_DATA = ${JSON.stringify(returnData)};\n` + html.substring(idx);
}
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Updated HTML');
