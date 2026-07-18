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

// Fetch all invoices + payment reports
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
        date: (inv.completionDate || inv.date).substring(0,10),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        pm: inv.paymentMethod || '',
        customer: (inv.customerName || '').trim(),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Invoices: ${allInv.length}`);

// Get payment reports per day
const dates = [...new Set(allInv.map(i => i.date))].sort();
const dailyPayments = {};
for (const date of dates) {
  const d = new Date(date + 'T00:00:00');
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); start.setUTCHours(start.getUTCHours() - 3);
  const end = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)); end.setUTCHours(end.getUTCHours() - 3);
  try {
    const res = await fetch(`${API_BASE}/reporting-bridge/dashboard/payment-methods-report?startDate=${start.toISOString()}&endDate=${end.toISOString()}&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      const m = data.paymentMethodsValues || [];
      dailyPayments[date] = {
        cash: m.find(x => x.type === 'Cash')?.total || 0,
        debit: m.find(x => x.type === 'CustomerDebit')?.total || 0,
      };
    }
  } catch(e) {}
}
console.log(`Payment data: ${Object.keys(dailyPayments).length} days`);

// ===== 1. WEEKLY REPORT =====
// Group by ISO week (week starts Saturday in Saudi)
const weekMap = {};
allInv.forEach(inv => {
  const d = new Date(inv.date + 'T00:00:00');
  // Week starts Saturday: find the Saturday of this week
  const dayOfWeek = d.getDay(); // 0=Sunday, 6=Saturday
  const daysSinceSaturday = (dayOfWeek + 1) % 7;
  const saturday = new Date(d);
  saturday.setDate(d.getDate() - daysSinceSaturday);
  const weekKey = saturday.toISOString().substring(0, 10);
  
  if (!weekMap[weekKey]) weekMap[weekKey] = {
    weekStart: weekKey,
    sales: 0, salesCount: 0, returns: 0, returnsCount: 0,
    customers: new Set(), cashSales: 0, cashCollections: 0,
    days: new Set(),
  };
  const w = weekMap[weekKey];
  w.days.add(inv.date);
  if (inv.type === 'sale') {
    w.sales += inv.total;
    w.salesCount++;
    if (inv.customer) w.customers.add(inv.customer);
    if (inv.pm === 'Cash') w.cashSales += inv.total;
  } else {
    w.returns += inv.total;
    w.returnsCount++;
  }
});

// Add collections and week end dates
Object.values(weekMap).forEach(w => {
  w.daysArray = [...w.days].sort();
  w.weekEnd = w.daysArray[w.daysArray.length - 1];
  // Collections = payment report cash - invoice cash sales
  let reportCash = 0;
  let invCash = 0;
  w.daysArray.forEach(d => {
    reportCash += dailyPayments[d]?.cash || 0;
  });
  w.cashCollections = Math.max(0, reportCash - w.cashSales);
  w.totalCashIn = reportCash;
  w.creditSales = w.sales - w.cashSales;
  w.net = w.sales - w.returns;
  w.avgPerDay = w.days.size > 0 ? w.sales / w.days.size : 0;
  w.avgInvoice = w.salesCount > 0 ? w.sales / w.salesCount : 0;
  w.activeDays = w.days.size;
  w.uniqueCustomers = w.customers.size;
});

const weekly = Object.values(weekMap).sort((a, b) => b.weekStart.localeCompare(a.weekStart));

console.log(`\n=== WEEKLY (${weekly.length} weeks) ===`);
weekly.slice(0, 5).forEach(w => {
  console.log(`${w.weekStart} → ${w.weekEnd}: sales=${w.sales.toFixed(0)} (${w.salesCount}) | cash=${w.cashSales.toFixed(0)} | coll=${w.cashCollections.toFixed(0)} | credit=${w.creditSales.toFixed(0)} | returns=${w.returns.toFixed(0)} | ${w.activeDays}d ${w.uniqueCustomers}c`);
});

// ===== 2. MONTHLY REPORT =====
const AR_MONTHS = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر'];
const monthMap = {};
allInv.forEach(inv => {
  const m = parseInt(inv.date.substring(5, 7));
  if (!monthMap[m]) monthMap[m] = {
    month: AR_MONTHS[m], monthNum: m,
    sales: 0, salesCount: 0, returns: 0, returnsCount: 0,
    customers: new Set(), cashSales: 0, activeDays: new Set(),
    bestDay: { date: '', sales: 0 },
    dailySales: {},
  };
  const mm = monthMap[m];
  if (inv.type === 'sale') {
    mm.sales += inv.total;
    mm.salesCount++;
    if (inv.customer) mm.customers.add(inv.customer);
    if (inv.pm === 'Cash') mm.cashSales += inv.total;
    mm.activeDays.add(inv.date);
    mm.dailySales[inv.date] = (mm.dailySales[inv.date] || 0) + inv.total;
    if (mm.dailySales[inv.date] > mm.bestDay.sales) mm.bestDay = { date: inv.date, sales: mm.dailySales[inv.date] };
  } else {
    mm.returns += inv.total;
    mm.returnsCount++;
  }
});

const monthly = Object.values(monthMap).sort((a, b) => a.monthNum - b.monthNum).map(m => {
  let reportCash = 0;
  m.activeDays.forEach(d => { reportCash += dailyPayments[d]?.cash || 0; });
  return {
    month: m.month, monthNum: m.monthNum,
    sales: +m.sales.toFixed(2), salesCount: m.salesCount,
    returns: +m.returns.toFixed(2), returnsCount: m.returnsCount,
    net: +(m.sales - m.returns).toFixed(2),
    cashSales: +m.cashSales.toFixed(2),
    creditSales: +(m.sales - m.cashSales).toFixed(2),
    cashCollections: +Math.max(0, reportCash - m.cashSales).toFixed(2),
    totalCashIn: +reportCash.toFixed(2),
    customers: m.customers.size,
    activeDays: m.activeDays.size,
    avgPerDay: m.activeDays.size > 0 ? +(m.sales / m.activeDays.size).toFixed(2) : 0,
    avgInvoice: m.salesCount > 0 ? +(m.sales / m.salesCount).toFixed(2) : 0,
    bestDay: m.bestDay,
    profitMargin: m.sales > 0 ? null : 0, // will be filled from monthly stats
  };
});

// Add profit from PAFTAH_DATA
const html0 = readFileSync(join(REPO_ROOT, 'paftah-comprehensive-report.html'), 'utf-8');
const mm0 = html0.match(/PAFTAH_DATA\.monthly = (\[[\s\S]*?\]);/);
if (mm0) {
  const stats = eval(mm0[1]);
  stats.filter(s => !s.isTotal).forEach(s => {
    const m = monthly.find(x => x.month === s.month);
    if (m) {
      m.profit = s.profit;
      m.margin = s.margin;
      m.netIncome = s.netIncome;
    }
  });
}

console.log(`\n=== MONTHLY (${monthly.length} months) ===`);
monthly.forEach(m => {
  console.log(`${m.month}: sales=${m.sales.toFixed(0)} (${m.salesCount}) | cash=${m.cashSales.toFixed(0)} | coll=${m.cashCollections.toFixed(0)} | credit=${m.creditSales.toFixed(0)} | returns=${m.returns.toFixed(0)} | ${m.customers}c ${m.activeDays}d | best=${m.bestDay.date}`);
});

// ===== 3. FULL AUDIT =====
const totalSales = allInv.filter(i => i.type === 'sale').reduce((s,i) => s+i.total, 0);
const totalReturns = allInv.filter(i => i.type === 'return').reduce((s,i) => s+i.total, 0);
const totalCashSales = allInv.filter(i => i.type === 'sale' && i.pm === 'Cash').reduce((s,i) => s+i.total, 0);
const totalCustomers = new Set(allInv.filter(i => i.type === 'sale' && i.customer).map(i => i.customer)).size;
const totalDays = dates.length;
let totalReportCash = 0;
Object.values(dailyPayments).forEach(d => totalReportCash += d.cash);

const audit = {
  period: '1 يناير - 18 يوليو 2026',
  totalDays,
  totalInvoices: allInv.length,
  totalSalesInvoices: allInv.filter(i => i.type === 'sale').length,
  totalReturnInvoices: allInv.filter(i => i.type === 'return').length,
  totalSales: +totalSales.toFixed(2),
  totalReturns: +totalReturns.toFixed(2),
  netSales: +(totalSales - totalReturns).toFixed(2),
  totalCashSales: +totalCashSales.toFixed(2),
  totalCreditSales: +(totalSales - totalCashSales).toFixed(2),
  totalCashCollections: +Math.max(0, totalReportCash - totalCashSales).toFixed(2),
  totalCashIn: +totalReportCash.toFixed(2),
  totalCustomers,
  avgDailySales: +(totalSales / totalDays).toFixed(2),
  avgInvoice: +(totalSales / allInv.filter(i => i.type === 'sale').length).toFixed(2),
  returnRate: +((allInv.filter(i => i.type === 'return').length / allInv.length) * 100).toFixed(1),
};

console.log(`\n=== AUDIT ===`);
console.log(JSON.stringify(audit, null, 2));

// ===== INJECT INTO HTML =====
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst WEEKLY_REPORT = .*?;\n/g, '\n');
html = html.replace(/\nconst MONTHLY_REPORT = .*?;\n/g, '\n');
html = html.replace(/\nconst FULL_AUDIT = .*?;\n/g, '\n');
const dataStr = `\nconst WEEKLY_REPORT = ${JSON.stringify(weekly.map(w => ({...w, customers: w.uniqueCustomers}))});\nconst MONTHLY_REPORT = ${JSON.stringify(monthly)};\nconst FULL_AUDIT = ${JSON.stringify(audit)};\n`;
const idx = html.indexOf('// ===== TAXES TAB');
if (idx > -1) html = html.substring(0, idx) + dataStr + html.substring(idx);
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ All reports injected');
