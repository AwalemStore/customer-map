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
        pm: inv.paymentMethod || '', month: d.getMonth() + 1, weekday: d.getDay(),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Invoices: ${allInv.length}`);

const AR_MONTHS = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر'];

// === DAILY SUMMARY WITH PAYMENT BREAKDOWN ===
const dailyMap = {};
allInv.forEach(inv => {
  if (!dailyMap[inv.date]) dailyMap[inv.date] = {
    date: inv.date, sales: 0, salesCount: 0, returns: 0, returnsCount: 0,
    customers: new Set(),
    cashSales: 0,        // بيع نقدي (sale + Cash)
    cashSalesCount: 0,
    postPaySales: 0,     // بيع آجل (sale + Post Pay)
    cardSales: 0,        // بيع بطاقة
    rewaaPaySales: 0,    // رواء باي
    collectionDebit: 0,  // تحصيل مدفوعات (Debit = customer paying debt)
    collectionDebitCount: 0,
    collectionCash: 0,   // تحصيل نقدي من المدفوعات
    collectionOther: 0,  // تحصيل آخر
    totalCollection: 0,  // إجمالي التحصيل من المدفوعات
  };
  const d = dailyMap[inv.date];
  
  if (inv.type === 'sale') {
    d.sales += inv.total;
    d.salesCount++;
    if (inv.customer) d.customers.add(inv.customer);
    
    // Separate by payment method
    if (inv.pm === 'Cash') {
      d.cashSales += inv.total;
      d.cashSalesCount++;
    } else if (inv.pm === 'Post Pay') {
      d.postPaySales += inv.total;
    } else if (inv.pm === 'Credit Card') {
      d.cardSales += inv.total;
    } else if (inv.pm === 'Rewaa Pay') {
      d.rewaaPaySales += inv.total;
    }
    
    // If payment method is Debit = customer paying off their debt
    if (inv.pm === 'Debit') {
      d.collectionDebit += inv.paid;
      d.collectionDebitCount++;
      d.totalCollection += inv.paid;
    }
    // Also count cash payments as collection if there's a paidAmount on a Post Pay invoice
    // (customer paid cash later for a previous آجل sale)
    if (inv.pm === 'Cash' && inv.paid > 0 && inv.paid !== inv.total) {
      // Partial cash payment - part is collection
      d.collectionCash += inv.paid;
      d.totalCollection += inv.paid;
    }
  } else {
    d.returns += inv.total;
    d.returnsCount++;
  }
});

const daily = Object.values(dailyMap).map(d => ({
  date: d.date,
  sales: +d.sales.toFixed(2),
  salesCount: d.salesCount,
  cashSales: +d.cashSales.toFixed(2),
  cashSalesCount: d.cashSalesCount,
  postPaySales: +d.postPaySales.toFixed(2),
  cardSales: +d.cardSales.toFixed(2),
  rewaaPaySales: +d.rewaaPaySales.toFixed(2),
  returns: +d.returns.toFixed(2),
  returnsCount: d.returnsCount,
  net: +(d.sales - d.returns).toFixed(2),
  collectionDebit: +d.collectionDebit.toFixed(2),
  collectionDebitCount: d.collectionDebitCount,
  collectionCash: +d.collectionCash.toFixed(2),
  totalCollection: +d.totalCollection.toFixed(2),
  customers: d.customers.size,
})).sort((a,b) => b.date.localeCompare(a.date));

console.log(`\n=== LAST 5 DAYS ===`);
daily.slice(0, 5).forEach(d => {
  console.log(`${d.date}: sales=${d.sales} (${d.salesCount}) | cashSales=${d.cashSales} (${d.cashSalesCount}) | postPay=${d.postPaySales} | collection=${d.totalCollection} (debit=${d.collectionDebit}) | returns=${d.returns} | customers=${d.customers}`);
});

// === QUARTERLY TAX ===
const quarters = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9] };
const quarterTax = {};
for (const [q, months] of Object.entries(quarters)) {
  const qSales = allInv.filter(i => i.type === 'sale' && months.includes(i.month));
  const qReturns = allInv.filter(i => i.type === 'return' && months.includes(i.month));
  const collected = qSales.reduce((s,i) => s + i.paid, 0);
  
  const payCust = {};
  qSales.filter(i => i.paid > 0).forEach(i => {
    if (!payCust[i.customer]) payCust[i.customer] = { paid: 0, count: 0, dates: [] };
    payCust[i.customer].paid += i.paid;
    payCust[i.customer].count++;
    payCust[i.customer].dates.push(i.date);
  });
  
  quarterTax[q] = {
    period: months.map(m => AR_MONTHS[m]).join(' - '), months,
    salesCount: qSales.length, returnsCount: qReturns.length,
    totalSales: +qSales.reduce((s,i) => s + i.total, 0).toFixed(2),
    totalReturns: +qReturns.reduce((s,i) => s + i.total, 0).toFixed(2),
    collected: +collected.toFixed(2),
    vatOnCollected: +(collected * 15 / 115).toFixed(2),
    netAfterVat: +(collected * 100 / 115).toFixed(2),
    returnsList: qReturns.map(r => ({ inv: r.num, date: r.date, amount: +r.total.toFixed(2), customer: r.customer, vat: +(r.total * 15/115).toFixed(2) })).sort((a,b) => b.amount - a.amount),
    payingCustomers: Object.entries(payCust).map(([name, info]) => ({ name, paid: +info.paid.toFixed(2), vat: +(info.paid * 15/115).toFixed(2), net: +(info.paid * 100/115).toFixed(2), count: info.count, firstDate: info.dates.sort()[0], lastDate: info.dates.sort().pop() })).sort((a,b) => b.paid - a.paid),
    payingCount: Object.keys(payCust).length,
  };
}

// === WEEKDAY STATS ===
const sales = allInv.filter(i => i.type === 'sale');
const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const weekdayStats = weekdays.map((name, i) => {
  const dayInv = sales.filter(s => s.weekday === i);
  return { day: name, count: dayInv.length, total: +dayInv.reduce((s,i) => s + i.total, 0).toFixed(2), avg: dayInv.length > 0 ? +(dayInv.reduce((s,i) => s + i.total, 0) / dayInv.length).toFixed(2) : 0 };
});

// Inject
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst QUARTER_TAXES = .*?;\n/g, '\n');
html = html.replace(/\nconst DAILY_SUMMARY = .*?;\n/g, '\n');
html = html.replace(/\nconst WEEKDAY_STATS = .*?;\n/g, '\n');
const dataStr = `\nconst QUARTER_TAXES = ${JSON.stringify(quarterTax)};\nconst DAILY_SUMMARY = ${JSON.stringify(daily)};\nconst WEEKDAY_STATS = ${JSON.stringify(weekdayStats)};\n`;
const idx = html.indexOf('// ===== TAXES TAB');
if (idx > -1) html = html.substring(0, idx) + dataStr + html.substring(idx);
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Dashboard updated with payment breakdown');
