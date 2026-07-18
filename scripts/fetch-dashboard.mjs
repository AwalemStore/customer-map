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

// Fetch everything
let offset = 0;
const allInv = [];
let hasMore = true;
while (hasMore) {
  const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=${offset}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  if (!res.ok) break;
  const data = await res.json();
  if (!data.data || data.data.length === 0) break;
  for (const inv of data.data) {
    const d = new Date(inv.completionDate || inv.date);
    if (d.getFullYear() === 2026 && d.getMonth() <= 8) {
      allInv.push({
        num: inv.invoiceNumber, date: (inv.completionDate || inv.date).substring(0,10),
        customer: (inv.customerName || '').trim(),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0), paid: parseFloat(inv.paidAmount || 0),
        pm: inv.paymentMethod || '', month: d.getMonth() + 1,
        day: d.getDate(), weekday: d.getDay(),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Invoices: ${allInv.length}`);

const sales = allInv.filter(i => i.type === 'sale');
const returns = allInv.filter(i => i.type === 'return');
const AR_MONTHS = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر'];

// === 1. QUARTERLY TAX ===
const quarters = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9] };
const quarterTax = {};
for (const [q, months] of Object.entries(quarters)) {
  const qSales = sales.filter(i => months.includes(i.month));
  const qReturns = returns.filter(i => months.includes(i.month));
  const collected = qSales.reduce((s,i) => s + i.paid, 0);
  const totalSales = qSales.reduce((s,i) => s + i.total, 0);
  const totalReturns = qReturns.reduce((s,i) => s + i.total, 0);
  
  // Paying customers grouped
  const payCust = {};
  qSales.filter(i => i.paid > 0).forEach(i => {
    if (!payCust[i.customer]) payCust[i.customer] = { paid: 0, count: 0, dates: [] };
    payCust[i.customer].paid += i.paid;
    payCust[i.customer].count++;
    payCust[i.customer].dates.push(i.date);
  });
  
  quarterTax[q] = {
    period: months.map(m => AR_MONTHS[m]).join(' - '),
    months,
    salesCount: qSales.length, returnsCount: qReturns.length,
    totalSales: +totalSales.toFixed(2), totalReturns: +totalReturns.toFixed(2),
    collected: +collected.toFixed(2),
    vatOnCollected: +(collected * 15 / 115).toFixed(2),
    netAfterVat: +(collected * 100 / 115).toFixed(2),
    returnsList: qReturns.map(r => ({ inv: r.num, date: r.date, amount: +r.total.toFixed(2), customer: r.customer, vat: +(r.total * 15/115).toFixed(2) })).sort((a,b) => b.amount - a.amount),
    payingCustomers: Object.entries(payCust).map(([name, info]) => ({
      name, paid: +info.paid.toFixed(2), vat: +(info.paid * 15/115).toFixed(2),
      net: +(info.paid * 100/115).toFixed(2), count: info.count,
      firstDate: info.dates.sort()[0], lastDate: info.dates.sort().pop(),
    })).sort((a,b) => b.paid - a.paid),
    payingCount: Object.keys(payCust).length,
  };
}

// === 2. DAILY SUMMARY ===
const dailyMap = {};
allInv.forEach(inv => {
  if (!dailyMap[inv.date]) dailyMap[inv.date] = { date: inv.date, sales: 0, salesCount: 0, returns: 0, returnsCount: 0, collected: 0, customers: new Set() };
  const d = dailyMap[inv.date];
  if (inv.type === 'sale') { d.sales += inv.total; d.salesCount++; if (inv.paid > 0) d.collected += inv.paid; if (inv.customer) d.customers.add(inv.customer); }
  else { d.returns += inv.total; d.returnsCount++; }
});
const daily = Object.values(dailyMap).map(d => ({
  date: d.date, sales: +d.sales.toFixed(2), salesCount: d.salesCount,
  returns: +d.returns.toFixed(2), returnsCount: d.returnsCount,
  net: +(d.sales - d.returns).toFixed(2), collected: +d.collected.toFixed(2),
  customers: d.customers.size,
})).sort((a,b) => b.date.localeCompare(a.date));

// === 3. HEATMAP: best days/weekdays ===
const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const weekdayStats = weekdays.map((name, i) => {
  const dayInv = sales.filter(s => s.weekday === i);
  return { day: name, count: dayInv.length, total: +dayInv.reduce((s,i) => s + i.total, 0).toFixed(2), avg: dayInv.length > 0 ? +(dayInv.reduce((s,i) => s + i.total, 0) / dayInv.length).toFixed(2) : 0 };
});

const dashboard = { quarterTax, daily, weekdayStats };

// Inject
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst QUARTER_TAXES = .*?;\n/g, '\n');
html = html.replace(/\nconst DAILY_SUMMARY = .*?;\n/g, '\n');
const dataStr = `\nconst QUARTER_TAXES = ${JSON.stringify(dashboard.quarterTax)};\nconst DAILY_SUMMARY = ${JSON.stringify(dashboard.daily)};\nconst WEEKDAY_STATS = ${JSON.stringify(dashboard.weekdayStats)};\n`;
const idx = html.indexOf('// ===== VIP CUSTOMERS');
if (idx > -1) html = html.substring(0, idx) + dataStr + html.substring(idx);
writeFileSync(htmlPath, html, 'utf-8');
console.log('✓ Dashboard data injected');
