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

// === 1. Fetch invoices ===
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
        total: parseFloat(inv.total || 0),
        pm: inv.paymentMethod || '',
        month: d.getMonth() + 1, weekday: d.getDay(),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Invoices: ${allInv.length}`);

const AR_MONTHS = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر'];

// === 2. Get unique dates ===
const dates = [...new Set(allInv.map(i => i.date))].sort();
console.log(`Dates: ${dates.length}`);

// === 3. Fetch payment methods report per day ===
const dailyPayments = {};
let dayCount = 0;
for (const date of dates) {
  const d = new Date(date + 'T00:00:00');
  const startUTC = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  startUTC.setUTCHours(startUTC.getUTCHours() - 3);
  const endUTC = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
  endUTC.setUTCHours(endUTC.getUTCHours() - 3);
  try {
    const res = await fetch(`${API_BASE}/reporting-bridge/dashboard/payment-methods-report?startDate=${startUTC.toISOString()}&endDate=${endUTC.toISOString()}&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      const methods = data.paymentMethodsValues || [];
      dailyPayments[date] = {
        cashTotal: methods.find(m => m.type === 'Cash')?.total || 0,       // إجمالي الكاش (بيع + تحصيل)
        debitTotal: methods.find(m => m.type === 'CustomerDebit')?.total || 0, // بيع آجل
        cardTotal: methods.find(m => m.type === 'Card')?.total || 0,
        rewaaTotal: methods.find(m => m.type === 'SoftPos')?.total || 0,
      };
    }
  } catch(e) {}
  dayCount++;
  if (dayCount % 20 === 0) console.log(`  Payments: ${dayCount}/${dates.length}`);
}
console.log(`Payment data: ${Object.keys(dailyPayments).length} days`);

// === 4. Build daily summary ===
const dailyMap = {};
allInv.forEach(inv => {
  if (!dailyMap[inv.date]) dailyMap[inv.date] = {
    date: inv.date, sales: 0, salesCount: 0, returns: 0, returnsCount: 0,
    customers: new Set(),
    cashSaleInvoices: 0,
    cashSaleTotal: 0,
    postPayInvoices: 0,
    postPayTotal: 0,
  };
  const d = dailyMap[inv.date];
  if (inv.type === 'sale') {
    d.sales += inv.total; d.salesCount++;
    if (inv.customer) d.customers.add(inv.customer);
    // Count cash sale invoices specifically
    if (inv.pm === 'Cash') {
      d.cashSaleInvoices++;
      d.cashSaleTotal += inv.total;
    } else if (inv.pm === 'Post Pay') {
      d.postPayInvoices++;
      d.postPayTotal += inv.total;
    }
  } else {
    d.returns += inv.total; d.returnsCount++;
  }
});

const daily = Object.values(dailyMap).map(d => {
  const pm = dailyPayments[d.date] || { cashTotal: 0, debitTotal: 0, cardTotal: 0, rewaaTotal: 0 };
  
  // SEPARATE: cash sales vs cash collections
  const cashSales = d.cashSaleTotal;           // new sales paid in cash (from invoice data)
  const cashCollections = Math.max(0, pm.cashTotal - cashSales); // remaining cash = debt collection
  
  return {
    date: d.date,
    sales: +d.sales.toFixed(2),
    salesCount: d.salesCount,
    returns: +d.returns.toFixed(2),
    returnsCount: d.returnsCount,
    net: +(d.sales - d.returns).toFixed(2),
    cashSales: +cashSales.toFixed(2),              // بيع نقدي (فواتير بيع جديدة بالكاش)
    cashSalesCount: d.cashSaleInvoices,            // عدد فواتير البيع النقدي
    cashCollections: +cashCollections.toFixed(2),   // تحصيل دفعات (سداد ديون قديمة بالكاش)
    creditSales: +(d.sales - d.cashSaleTotal).toFixed(2),  // بيع آجل = المتبقي بعد النقدي
    cardSales: +pm.cardTotal.toFixed(2),            // بطاقة
    rewaaPaySales: +pm.rewaaTotal.toFixed(2),       // رواء باي
    totalCashIn: +pm.cashTotal.toFixed(2),          // إجمالي الكاش الداخل (بيع + تحصيل)
    customers: d.customers.size,
  };
}).sort((a,b) => b.date.localeCompare(a.date));

console.log(`\n=== LAST 5 DAYS ===`);
daily.slice(0, 5).forEach(d => {
  console.log(`${d.date}: sales=${d.sales} (${d.salesCount}) | بيع نقدي=${d.cashSales} (${d.cashSalesCount}) | تحصيل=${d.cashCollections} | آجل=${d.creditSales} | إجمالي كاش=${d.totalCashIn} | مرتجع=${d.returns} | عملاء=${d.customers}`);
});

// === 5. Quarterly tax ===
const quarters = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9] };
const quarterTax = {};
for (const [q, months] of Object.entries(quarters)) {
  const qSales = allInv.filter(i => i.type === 'sale' && months.includes(i.month));
  const qReturns = allInv.filter(i => i.type === 'return' && months.includes(i.month));
  let qCash = 0, qCollections = 0, qCredit = 0;
  daily.forEach(d => {
    const m = parseInt(d.date.split('-')[1]);
    if (months.includes(m)) { qCash += d.cashSales; qCollections += d.cashCollections; qCredit += d.creditSales; }
  });
  quarterTax[q] = {
    period: months.map(m => AR_MONTHS[m]).join(' - '), months,
    salesCount: qSales.length, returnsCount: qReturns.length,
    totalSales: +qSales.reduce((s,i) => s + i.total, 0).toFixed(2),
    totalReturns: +qReturns.reduce((s,i) => s + i.total, 0).toFixed(2),
    cashSales: +qCash.toFixed(2),
    cashCollections: +qCollections.toFixed(2),
    totalCashIn: +(qCash + qCollections).toFixed(2),
    creditSales: +qCredit.toFixed(2),
    vatOnCashIn: +((qCash + qCollections) * 15 / 115).toFixed(2),
    returnsList: qReturns.map(r => ({ inv: r.num, date: r.date, amount: +r.total.toFixed(2), customer: r.customer, vat: +(r.total * 15/115).toFixed(2) })).sort((a,b) => b.amount - a.amount),
  };
}

// === 6. Weekday stats ===
const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const weekdayStats = weekdays.map((name, i) => {
  const dayInv = allInv.filter(s => s.type === 'sale' && s.weekday === i);
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
console.log('\n✓ Dashboard with separated cash sales vs collections');
