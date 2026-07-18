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

// Fetch ALL invoices Jan-Sep 2026
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
    if (d.getFullYear() === 2026 && d.getMonth() <= 8) {
      allInvoices.push({
        num: inv.invoiceNumber,
        date: (inv.completionDate || inv.date).substring(0, 10),
        customer: (inv.customerName || '').trim(),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        paid: parseFloat(inv.paidAmount || 0),
        pm: inv.paymentMethod || '',
        month: d.getMonth() + 1, // 1-12
        dayKey: (inv.completionDate || inv.date).substring(0, 10),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Total invoices: ${allInvoices.length}`);

// ===== BUILD QUARTERLY TAX DATA =====
const quarters = {
  Q1: { name: 'الربع الأول', months: [1,2,3], period: 'يناير - مارس 2026' },
  Q2: { name: 'الربع الثاني', months: [4,5,6], period: 'أبريل - يونيو 2026' },
  Q3: { name: 'الربع الثالث', months: [7,8,9], period: 'يوليو - سبتمبر 2026' },
};

const quarterData = {};

for (const [qKey, q] of Object.entries(quarters)) {
  const qInv = allInvoices.filter(i => q.months.includes(i.month));
  const sales = qInv.filter(i => i.type === 'sale');
  const returns = qInv.filter(i => i.type === 'return');
  
  // Sales by payment method
  const cashSales = sales.filter(i => i.pm === 'Cash');
  const postPaySales = sales.filter(i => i.pm === 'Post Pay');
  const cardSales = sales.filter(i => i.pm === 'Credit Card');
  const rewaaPaySales = sales.filter(i => i.pm === 'Rewaa Pay');
  const debitSales = sales.filter(i => i.pm === 'Debit');
  
  const totalSales = sales.reduce((s,i) => s + i.total, 0);
  const totalReturns = returns.reduce((s,i) => s + i.total, 0);
  const totalCollected = sales.reduce((s,i) => s + i.paid, 0); // actual cash collected
  
  // Customers who paid
  const payingCustomers = {};
  sales.filter(i => i.paid > 0).forEach(i => {
    if (!payingCustomers[i.customer]) payingCustomers[i.customer] = { totalPaid: 0, count: 0, dates: [] };
    payingCustomers[i.customer].totalPaid += i.paid;
    payingCustomers[i.customer].count++;
    payingCustomers[i.customer].dates.push(i.date);
  });
  
  const customerList = Object.entries(payingCustomers)
    .map(([name, info]) => ({
      name,
      totalPaid: +info.totalPaid.toFixed(2),
      vat: +(info.totalPaid * 15 / 115).toFixed(2),
      net: +(info.totalPaid * 100 / 115).toFixed(2),
      invoiceCount: info.count,
      firstDate: info.dates.sort()[0],
      lastDate: info.dates.sort().pop(),
    }))
    .sort((a, b) => b.totalPaid - a.totalPaid);

  quarterData[qKey] = {
    name: q.name,
    period: q.period,
    months: q.months,
    totalSales: +totalSales.toFixed(2),
    totalReturns: +totalReturns.toFixed(2),
    netSales: +(totalSales - totalReturns).toFixed(2),
    totalCollected: +totalCollected.toFixed(2),
    salesCount: sales.length,
    returnsCount: returns.length,
    payingCustomerCount: customerList.length,
    vatOnCollected: +(totalCollected * 15 / 115).toFixed(2),
    netAfterVat: +(totalCollected * 100 / 115).toFixed(2),
    paymentBreakdown: {
      cash: { count: cashSales.length, total: +cashSales.reduce((s,i) => s + i.total, 0).toFixed(2) },
      postPay: { count: postPaySales.length, total: +postPaySales.reduce((s,i) => s + i.total, 0).toFixed(2) },
      card: { count: cardSales.length, total: +cardSales.reduce((s,i) => s + i.total, 0).toFixed(2) },
      rewaaPay: { count: rewaaPaySales.length, total: +rewaaPaySales.reduce((s,i) => s + i.total, 0).toFixed(2) },
      debit: { count: debitSales.length, total: +debitSales.reduce((s,i) => s + i.total, 0).toFixed(2) },
    },
    returns: returns.map(r => ({
      invoice: r.num, date: r.date, amount: +r.total.toFixed(2),
      customer: r.customer, vat: +(r.total * 15 / 115).toFixed(2),
    })).sort((a,b) => b.amount - a.amount),
    customers: customerList.slice(0, 100),
  };

  console.log(`\n${q.name} (${q.period}):`);
  console.log(`  Sales: ${totalSales.toFixed(2)} (${sales.length} invoices)`);
  console.log(`  Returns: ${totalReturns.toFixed(2)} (${returns.length} invoices)`);
  console.log(`  Collected (cash basis): ${totalCollected.toFixed(2)}`);
  console.log(`  VAT on collected: ${(totalCollected * 15 / 115).toFixed(2)}`);
  console.log(`  Paying customers: ${customerList.length}`);
}

// ===== BUILD DAILY SUMMARY =====
const dailyMap = {};
allInvoices.forEach(inv => {
  const key = inv.dayKey;
  if (!dailyMap[key]) dailyMap[key] = { date: key, sales: 0, salesCount: 0, returns: 0, returnsCount: 0, collected: 0, customers: new Set() };
  if (inv.type === 'sale') {
    dailyMap[key].sales += inv.total;
    dailyMap[key].salesCount++;
    if (inv.paid > 0) dailyMap[key].collected += inv.paid;
    if (inv.customer) dailyMap[key].customers.add(inv.customer);
  } else {
    dailyMap[key].returns += inv.total;
    dailyMap[key].returnsCount++;
  }
});

const dailySummary = Object.values(dailyMap)
  .map(d => ({
    date: d.date,
    sales: +d.sales.toFixed(2),
    salesCount: d.salesCount,
    returns: +d.returns.toFixed(2),
    returnsCount: d.returnsCount,
    net: +(d.sales - d.returns).toFixed(2),
    collected: +d.collected.toFixed(2),
    newCustomers: d.customers.size,
  }))
  .sort((a, b) => b.date.localeCompare(a.date));

console.log(`\nDaily entries: ${dailySummary.length}`);

// ===== INJECT INTO HTML =====
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');

// Remove old data
html = html.replace(/\nconst QUARTER_TAXES = .*?;\n/g, '\n');
html = html.replace(/\nconst DAILY_SUMMARY = .*?;\n/g, '\n');

const dataStr = `\nconst QUARTER_TAXES = ${JSON.stringify(quarterData)};\nconst DAILY_SUMMARY = ${JSON.stringify(dailySummary)};\n`;
const idx = html.indexOf('// ===== VIP CUSTOMERS');
if (idx > -1) {
  html = html.substring(0, idx) + dataStr + html.substring(idx);
}

writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Injected quarter taxes + daily summary');
