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

// Fetch ALL invoices Jan-Jun 2026
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
    if (d.getFullYear() === 2026 && d.getMonth() <= 5) {
      allInvoices.push({
        num: inv.invoiceNumber,
        date: (inv.completionDate || inv.date).substring(0, 10),
        customer: (inv.customerName || '').trim(),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        paid: parseFloat(inv.paidAmount || 0),
        pm: inv.paymentMethod || '',
        month: d.getMonth(), // 0-11
      });
    }
    if (d.getFullYear() === 2026 && d.getMonth() < 0) { hasMore = false; break; }}
  offset += 50;
  if (data.data.length < 50) hasMore = false;
  console.log(`  Fetched ${offset}, total: ${allInvoices.length}`);
}

// Q1 sales = Jan(0) to Mar(2)
const q1Sales = allInvoices.filter(i => i.type === 'sale' && i.month >= 0 && i.month <= 2);
// Returns after Q1 = Apr(3) onwards (Q2 + Q3 + ...)
const laterReturns = allInvoices.filter(i => i.type === 'return' && i.month >= 3);

console.log(`\nQ1 Sales (Jan-Mar): ${q1Sales.length}`);
console.log(`Returns after Q1 (Apr+): ${laterReturns.length}`);

// Match Q2 returns to Q1 sales by customer
// Group Q1 sales by customer
const q1ByCustomer = {};
q1Sales.forEach(s => {
  const name = s.customer;
  if (!q1ByCustomer[name]) q1ByCustomer[name] = [];
  q1ByCustomer[name].push(s);
});

// For each return after Q1, check if the customer had Q1 sales
const matchedReturns = [];
laterReturns.forEach(r => {
  const q1CustomerSales = q1ByCustomer[r.customer] || [];
  if (q1CustomerSales.length > 0) {
    matchedReturns.push({
      returnInvoice: r.num,
      returnDate: r.date,
      returnAmount: r.total,
      customer: r.customer,
      paymentMethod: r.pm,
      q1SalesCount: q1CustomerSales.length,
      q1SalesTotal: q1CustomerSales.reduce((s, x) => s + x.total, 0),
      q1FirstSale: q1CustomerSales.sort((a, b) => a.date.localeCompare(b.date))[0].date,
      q1LastSale: q1CustomerSales.sort((a, b) => b.date.localeCompare(a.date))[0].date,
      q1Invoices: q1CustomerSales.map(s => s.num).join(', '),
    });
  }
});

console.log(`\nMatched returns (Q1 sales returned in Q2+): ${matchedReturns.length}`);
console.log(`Total return amount: ${matchedReturns.reduce((s, r) => s + r.returnAmount, 0).toFixed(2)}`);
console.log(`VAT deduction (15%): ${(matchedReturns.reduce((s, r) => s + r.returnAmount, 0) * 15 / 115).toFixed(2)}`);

matchedReturns.forEach(r => {
  console.log(`  ${r.customer.substring(0, 35).padEnd(35)} | return: ${r.returnDate} ${r.returnAmount.toString().padStart(8)} | Q1 sales: ${r.q1SalesCount} (${r.q1FirstSale} → ${r.q1LastSale}) = ${r.q1SalesTotal}`);
});

// Build data for HTML
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
    paymentMethod: r.paymentMethod,
    q1SalesCount: r.q1SalesCount,
    q1SalesTotal: +r.q1SalesTotal.toFixed(2),
    q1FirstSale: r.q1FirstSale,
    q1LastSale: r.q1LastSale,
    q1Invoices: r.q1Invoices,
  })),
};

// Inject into HTML
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');

// Remove old data
html = html.replace(/\nconst Q1_RETURNS_DATA = .*?;\n/g, '\n');

// Inject before tax functions
const taxFuncIdx = html.indexOf('// ===== TAX TAB');
if (taxFuncIdx > -1) {
  html = html.substring(0, taxFuncIdx) + `\nconst Q1_RETURNS_DATA = ${JSON.stringify(returnData)};\n` + html.substring(taxFuncIdx);
}

writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Updated HTML with Q1 returns data');
