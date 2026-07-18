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
      const isReturn = inv.isReturn || inv.invoiceNumber?.startsWith('R');
      if (!isReturn) {
        allInvoices.push({
          num: inv.invoiceNumber,
          date: (inv.completionDate || inv.date).substring(0, 10),
          customer: (inv.customerName || '').trim(),
          total: parseFloat(inv.total || 0),
          month: d.getMonth() + 1, // 1-7
        });
      }
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Total sale invoices: ${allInvoices.length}`);

// === 1. NEW CUSTOMERS PER MONTH ===
// A customer is "new" in the month they first appear
const firstSeen = {};
allInvoices.forEach(inv => {
  const name = inv.customer;
  if (!firstSeen[name] || inv.date < firstSeen[name].date) {
    firstSeen[name] = { date: inv.date, month: inv.month, invoice: inv.num };
  }
});

const monthNames = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو'];
const newByMonth = {};
for (let m = 1; m <= 7; m++) {
  newByMonth[m] = [];
}
Object.entries(firstSeen).forEach(([name, info]) => {
  if (info.month >= 1 && info.month <= 7) {
    newByMonth[info.month].push({ name, firstDate: info.date, firstInvoice: info.invoice });
  }
});

console.log('\n=== NEW CUSTOMERS PER MONTH ===');
const newCustomersData = [];
for (let m = 1; m <= 7; m++) {
  const count = newByMonth[m].length;
  console.log(`${monthNames[m]}: ${count} عميل جديد`);
  newCustomersData.push({ month: monthNames[m], count, customers: newByMonth[m].slice(0, 5).map(c => c.name) });
}

// === 2. LOYAL / REPEAT CUSTOMERS ===
// Count purchases per customer
const purchaseCount = {};
allInvoices.forEach(inv => {
  const name = inv.customer;
  if (!purchaseCount[name]) purchaseCount[name] = { count: 0, total: 0, dates: [], months: new Set() };
  purchaseCount[name].count++;
  purchaseCount[name].total += inv.total;
  purchaseCount[name].dates.push(inv.date);
  purchaseCount[name].months.add(inv.month);
});

// Repeat customers = bought 2+ times
const repeatCustomers = Object.entries(purchaseCount)
  .filter(([_, info]) => info.count >= 2)
  .sort((a, b) => b[1].count - a[1].count)
  .map(([name, info]) => ({
    name,
    purchases: info.count,
    totalSpent: +info.total.toFixed(2),
    monthsActive: info.months.size,
    firstPurchase: info.dates.sort()[0],
    lastPurchase: info.dates.sort().pop(),
    avgPerPurchase: +(info.total / info.count).toFixed(2),
  }));

console.log(`\n=== REPEAT CUSTOMERS (2+ purchases) ===`);
console.log(`Total: ${repeatCustomers.length}`);
repeatCustomers.slice(0, 20).forEach(c => {
  console.log(`  ${c.name.substring(0,35).padEnd(35)} | ${c.purchases} مشتريات | ${c.totalSpent.toString().padStart(8)} ر.س | ${c.monthsActive} أشهر | آخر: ${c.lastPurchase}`);
});

// VIP customers = 5+ purchases OR 1000+ ر.س total
const vipCustomers = repeatCustomers.filter(c => c.purchases >= 5 || c.totalSpent >= 1000);
console.log(`\nVIP customers (5+ purchases or 1000+ ر.س): ${vipCustomers.length}`);

// Build analytics object
const analytics = {
  newCustomersByMonth: newCustomersData,
  totalNewCustomers: Object.values(newByMonth).reduce((s, arr) => s + arr.length, 0),
  repeatCustomers: repeatCustomers.slice(0, 50),
  repeatCount: repeatCustomers.length,
  vipCustomers: vipCustomers,
  vipCount: vipCustomers.length,
  totalActiveCustomers: Object.keys(purchaseCount).length,
};

// Inject into HTML
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst CUSTOMER_ANALYTICS = .*?;\n/g, '\n');
const idx = html.indexOf('// ===== Q1 RETURNS');
if (idx > -1) {
  html = html.substring(0, idx) + `\nconst CUSTOMER_ANALYTICS = ${JSON.stringify(analytics)};\n` + html.substring(idx);
}
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Injected customer analytics');
