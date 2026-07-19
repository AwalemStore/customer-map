function cleanForJson(obj) {
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    if (value instanceof Set) return [...value];
    return value;
  }));
}

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const TZ = 'Asia/Riyadh';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;
console.log('✓ Authenticated');

function monthRange(m) {
  const start = new Date(Date.UTC(2026, m-1, 1)); start.setUTCHours(start.getUTCHours() - 3);
  const end = new Date(Date.UTC(2026, m, 1)); end.setUTCHours(end.getUTCHours() - 3); end.setUTCMilliseconds(-1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// === 1. Fetch daily charts (OFFICIAL Rewaa numbers) ===
console.log('[1] Fetching daily charts...');
const allDaily = [];
for (let m = 1; m <= 7; m++) {
  const { start, end } = monthRange(m);
  const res = await fetch(`${API_BASE}/reporting-bridge/dashboard/charts/days?startDate=${start}&endDate=${end}&timezone=${TZ}&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  if (res.ok) {
    const data = await res.json();
    if (Array.isArray(data)) allDaily.push(...data);
  }
  console.log(`  Month ${m}: ${allDaily.length} total days`);
}
console.log(`Total daily entries: ${allDaily.length}`);

// === 2. Fetch payment methods per day ===
console.log('[2] Fetching payment methods...');
const dates = allDaily.map(d => d.date.substring(0, 10));
const dailyPayments = {};
for (const date of dates) {
  const d = new Date(date + 'T00:00:00');
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); start.setUTCHours(start.getUTCHours() - 3);
  const end = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)); end.setUTCHours(end.getUTCHours() - 3);
  try {
    const res = await fetch(`${API_BASE}/reporting-bridge/dashboard/payment-methods-report?startDate=${start.toISOString()}&endDate=${end.toISOString()}&timezone=${TZ}&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data = await res.json();
      const m = data.paymentMethodsValues || [];
      dailyPayments[date] = { cash: m.find(x => x.type === 'Cash')?.total || 0 };
    }
  } catch(e) {}
}
console.log(`Payment data: ${Object.keys(dailyPayments).length} days`);

// === 3. Fetch invoices for customer counts + cash sales breakdown ===
console.log('[3] Fetching invoices for customer data...');
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
    // Include all invoices from 2025-12-31 onwards (Rewaa counts Dec 31 in current period)
    if (d.getFullYear() >= 2025) {
      allInv.push({
        date: (inv.completionDate || inv.date).substring(0,10),
        num: inv.invoiceNumber || '',
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        pm: inv.paymentMethod || '',
        customer: (inv.customerName || '').trim(),
        weekday: d.getDay(),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Invoices: ${allInv.length}`);

// === 4. Build daily summary from charts API ===
const daily = allDaily.map(d => {
  const date = d.date.substring(0, 10);
  const sales = d.sales || 0;
  const returns = d.returns || 0;
  const salesCount = d.salesCount || 0;
  
  // Customer count from invoices
  const dayInv = allInv.filter(i => i.date === date);
  const customers = new Set(dayInv.filter(i => i.type === 'sale' && i.customer).map(i => i.customer)).size;
  
  // Cash sales from invoices
  const cashInvTotal = dayInv.filter(i => i.type === 'sale' && i.pm === 'Cash').reduce((s,i) => s + i.total, 0);
  
  // Collections = payment report cash - invoice cash
  const reportCash = dailyPayments[date]?.cash || 0;
  const cashCollections = Math.max(0, reportCash - cashInvTotal);
  const creditSales = sales - cashInvTotal;
  
  return {
    date,
    sales: +sales.toFixed(2),
    salesCount,
    returns: +returns.toFixed(2),
    returnsCount: dayInv.filter(i => i.type === 'return').length,
    net: +(sales - returns).toFixed(2),
    cashSales: +cashInvTotal.toFixed(2),
    cashCollections: +cashCollections.toFixed(2),
    creditSales: +creditSales.toFixed(2),
    totalCashIn: +reportCash.toFixed(2),
    customers,
  };
}).sort((a,b) => b.date.localeCompare(a.date));

console.log(`\n=== LAST 5 DAYS (from charts API) ===`);
daily.slice(0, 5).forEach(d => {
  console.log(`${d.date}: sales=${d.sales} (${d.salesCount}) | نقدي=${d.cashSales} | تحصيل=${d.cashCollections} | آجل=${d.creditSales} | مرتجع=${d.returns} | عملاء=${d.customers}`);
});

// === 5. Quarterly tax ===
const AR_MONTHS = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر'];
const quarters = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9] };
const quarterTax = {};
for (const [q, months] of Object.entries(quarters)) {
  const qDaily = daily.filter(d => months.includes(parseInt(d.date.split('-')[1])));
  const qSales = qDaily.reduce((s,d) => s + d.sales, 0);
  const qReturns = qDaily.reduce((s,d) => s + d.returns, 0);
  const qCash = qDaily.reduce((s,d) => s + d.cashSales, 0);
  const qColl = qDaily.reduce((s,d) => s + d.cashCollections, 0);
  
  const qReturnInv = allInv.filter(i => i.type === 'return' && months.includes(parseInt(i.date.split('-')[1])));
  
  quarterTax[q] = {
    period: months.map(m => AR_MONTHS[m]).join(' - '), months,
    salesCount: qDaily.reduce((s,d) => s + d.salesCount, 0),
    returnsCount: qReturnInv.length,
    totalSales: +qSales.toFixed(2),
    totalReturns: +qReturns.toFixed(2),
    cashSales: +qCash.toFixed(2),
    cashCollections: +qColl.toFixed(2),
    totalCashIn: +(qCash + qColl).toFixed(2),
    creditSales: +(qSales - qCash).toFixed(2),
    vatOnCashIn: +((qCash + qColl) * 15 / 115).toFixed(2),
    returnsList: qReturnInv.map(r => ({ inv: '', date: r.date, amount: +r.total.toFixed(2), customer: r.customer, vat: +(r.total * 15/115).toFixed(2) })).sort((a,b) => b.amount - a.amount),
  };
}

// === 6. Weekday stats ===
const weekdays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const weekdayStats = weekdays.map((name, i) => {
  const dayData = daily.filter(d => new Date(d.date + 'T00:00:00').getDay() === i);
  return { day: name, count: dayData.reduce((s,d) => s + d.salesCount, 0), total: +dayData.reduce((s,d) => s + d.sales, 0).toFixed(2), avg: dayData.length > 0 ? +(dayData.reduce((s,d) => s + d.sales, 0) / dayData.length).toFixed(2) : 0 };
});

// === 7. Audit ===
const audit = {
  period: '1 يناير - 18 يوليو 2026',
  totalDays: daily.length,
  totalSales: +daily.reduce((s,d) => s + d.sales, 0).toFixed(2),
  totalReturns: +daily.reduce((s,d) => s + d.returns, 0).toFixed(2),
  netSales: +daily.reduce((s,d) => s + d.net, 0).toFixed(2),
  totalCashSales: +daily.reduce((s,d) => s + d.cashSales, 0).toFixed(2),
  totalCashCollections: +daily.reduce((s,d) => s + d.cashCollections, 0).toFixed(2),
  totalCashIn: +daily.reduce((s,d) => s + d.totalCashIn, 0).toFixed(2),
  totalCreditSales: +daily.reduce((s,d) => s + d.creditSales, 0).toFixed(2),
  totalSalesCount: daily.reduce((s,d) => s + d.salesCount, 0),
  avgDailySales: +(daily.reduce((s,d) => s + d.sales, 0) / daily.length).toFixed(2),
  avgInvoice: +(daily.reduce((s,d) => s + d.sales, 0) / daily.reduce((s,d) => s + d.salesCount, 0)).toFixed(2),
};
console.log(`\n=== AUDIT ===`);
console.log(JSON.stringify(audit, null, 2));

// === 8. Weekly report ===
const weekMap = {};
daily.forEach(d => {
  const dt = new Date(d.date + 'T00:00:00');
  const daysSinceSaturday = (dt.getDay() + 1) % 7;
  const saturday = new Date(dt);
  saturday.setDate(dt.getDate() - daysSinceSaturday);
  const weekKey = saturday.toISOString().substring(0, 10);
  if (!weekMap[weekKey]) weekMap[weekKey] = { weekStart: weekKey, days: [], sales: 0, salesCount: 0, returns: 0, cashSales: 0, cashCollections: 0, creditSales: 0, totalCashIn: 0, customers: 0 };
  const w = weekMap[weekKey];
  w.days.push(d.date);
  w.sales += d.sales; w.salesCount += d.salesCount; w.returns += d.returns;
  w.cashSales += d.cashSales; w.cashCollections += d.cashCollections;
  w.creditSales += d.creditSales; w.totalCashIn += d.totalCashIn;
  w.customers += d.customers;
});
const weekly = Object.values(weekMap).map(w => ({
  weekStart: w.weekStart, weekEnd: w.days.sort().pop(),
  activeDays: w.days.length,
  sales: +w.sales.toFixed(2), salesCount: w.salesCount,
  returns: +w.returns.toFixed(2),
  net: +(w.sales - w.returns).toFixed(2),
  cashSales: +w.cashSales.toFixed(2), cashCollections: +w.cashCollections.toFixed(2),
  creditSales: +w.creditSales.toFixed(2), totalCashIn: +w.totalCashIn.toFixed(2),
  avgPerDay: w.days.length > 0 ? +(w.sales / w.days.length).toFixed(2) : 0,
  avgInvoice: w.salesCount > 0 ? +(w.sales / w.salesCount).toFixed(2) : 0,
  customers: w.customers,
})).sort((a,b) => b.weekStart.localeCompare(a.weekStart));

// === 9. Monthly report ===
const monthly = [];
for (let m = 1; m <= 7; m++) {
  const mDaily = daily.filter(d => parseInt(d.date.split('-')[1]) === m);
  if (mDaily.length === 0) continue;
  const bestDay = mDaily.reduce((a, b) => a.sales > b.sales ? a : b);
  monthly.push({
    month: AR_MONTHS[m], monthNum: m,
    sales: +mDaily.reduce((s,d) => s + d.sales, 0).toFixed(2),
    salesCount: mDaily.reduce((s,d) => s + d.salesCount, 0),
    returns: +mDaily.reduce((s,d) => s + d.returns, 0).toFixed(2),
    net: +mDaily.reduce((s,d) => s + d.net, 0).toFixed(2),
    cashSales: +mDaily.reduce((s,d) => s + d.cashSales, 0).toFixed(2),
    cashCollections: +mDaily.reduce((s,d) => s + d.cashCollections, 0).toFixed(2),
    creditSales: +mDaily.reduce((s,d) => s + d.creditSales, 0).toFixed(2),
    totalCashIn: +mDaily.reduce((s,d) => s + d.totalCashIn, 0).toFixed(2),
    activeDays: mDaily.length,
    avgPerDay: +(mDaily.reduce((s,d) => s + d.sales, 0) / mDaily.length).toFixed(2),
    avgInvoice: mDaily.reduce((s,d) => s + d.salesCount, 0) > 0 ? +(mDaily.reduce((s,d) => s + d.sales, 0) / mDaily.reduce((s,d) => s + d.salesCount, 0)).toFixed(2) : 0,
    bestDay: { date: bestDay.date, sales: bestDay.sales },
  });
}

// === INJECT ===
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst QUARTER_TAXES = .*?;\n/g, '\n');
html = html.replace(/\nconst DAILY_SUMMARY = .*?;\n/g, '\n');
html = html.replace(/\nconst WEEKDAY_STATS = .*?;\n/g, '\n');
html = html.replace(/\nconst WEEKLY_REPORT = .*?;\n/g, '\n');
html = html.replace(/\nconst MONTHLY_REPORT = .*?;\n/g, '\n');
html = html.replace(/\nconst FULL_AUDIT = .*?;\n/g, '\n');

const dataStr = '\nconst QUARTER_TAXES = ' + JSON.stringify(quarterTax) + ';\n' +
  'const DAILY_SUMMARY = ' + JSON.stringify(daily) + ';\n' +
  'const WEEKDAY_STATS = ' + JSON.stringify(weekdayStats) + ';\n' +
  'const WEEKLY_REPORT = ' + JSON.stringify(weekly) + ';\n' +
  'const MONTHLY_REPORT = ' + JSON.stringify(monthly) + ';\n' +
  'const FULL_AUDIT = ' + JSON.stringify(audit) + ';\n';

const idx = html.indexOf('// ===== TAXES TAB');
if (idx > -1) html = html.substring(0, idx) + dataStr + html.substring(idx);
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ All data injected from official Rewaa charts API');

// === CLEAN INVOICES ARRAY ===
// Replace the duplicated invoices with clean unique ones
// Sort by invoice number ascending (and date as fallback) - oldest first (Jan 1 → today)
const cleanInvoices = [];
const seenNums = new Set();
allInv.forEach(inv => {
  const key = inv.num || (inv.date + inv.customer + inv.total);
  if (!seenNums.has(key)) {
    seenNums.add(key);
    cleanInvoices.push({
      date: inv.date,
      num: inv.num || '',
      type: inv.type,
      amount: +inv.total.toFixed(2),
    });
  }
});
// Sort by invoice number asc; returns ('R...') sort by their number too
cleanInvoices.sort((a, b) => {
  // Sale invoices first (no R prefix), then returns
  const aIsReturn = a.num.startsWith('R');
  const bIsReturn = b.num.startsWith('R');
  if (aIsReturn !== bIsReturn) return aIsReturn ? 1 : -1;
  // Within same type: numeric sort by invoice number
  const aNum = parseInt(a.num.replace(/\D/g, '')) || 0;
  const bNum = parseInt(b.num.replace(/\D/g, '')) || 0;
  if (aNum !== bNum) return aNum - bNum;
  // Fallback: by date asc
  return a.date.localeCompare(b.date);
});
console.log(`Clean invoices: ${cleanInvoices.length} (was ${allInv.length})`);
console.log(`  Sales: ${cleanInvoices.filter(i => i.type === 'sale').length}`);
console.log(`  Returns: ${cleanInvoices.filter(i => i.type === 'return').length}`);
if (cleanInvoices.length > 0) {
  console.log(`  Date range: ${cleanInvoices[0].date} → ${cleanInvoices[cleanInvoices.length-1].date}`);
  console.log(`  First: ${cleanInvoices[0].num} | Last: ${cleanInvoices[cleanInvoices.length-1].num}`);
}

// Replace invoices in HTML
const invStart = html.indexOf('const invoices = ');
const invEnd = html.indexOf('];', invStart) + 2;
if (invStart > -1 && invEnd > invStart) {
  const newInv = 'const invoices = ' + JSON.stringify(cleanInvoices);
  html = html.substring(0, invStart) + newInv + ';' + html.substring(invEnd);
  console.log('✓ Replaced invoices array with clean data (' + cleanInvoices.length + ' invoices)');
} else {
  console.log('⚠ Could not find invoices array in HTML');
}

// === SYNC "عمليات البيع" COUNTER WITH ACTUAL INVOICE COUNT ===
const saleCount = cleanInvoices.filter(i => i.type === 'sale').length;
const returnCount = cleanInvoices.filter(i => i.type === 'return').length;
const oldCounter = html.match(/data-count="(\d+)" data-int="1">0<\/div>\s*<div class="sub">يناير - يوليو 2026/);
html = html.replace(
  /data-count="\d+" data-int="1">0<\/div>(\s*)<div class="sub">يناير - يوليو 2026/,
  `data-count="${saleCount}" data-int="1">0</div>$1<div class="sub">يناير - يوليو 2026`
);
console.log(`✓ Synced "عمليات البيع" counter: ${oldCounter?.[1] || '?'} → ${saleCount} (sales) | ${returnCount} returns`);

// === SYNC ALL HEADER VALUES FROM PAFTAH_DATA ===
// Extract monthly total from PAFTAH_DATA in HTML
const paftahMatch = html.match(/const PAFTAH_DATA = (\{"districts.*?\});\s*const/s);
if (paftahMatch) {
  const paftah = JSON.parse(paftahMatch[1]);
  const months = paftah.monthly.filter(m => !m.isTotal);
  const total = paftah.monthly.find(m => m.isTotal) || {};
  
  // Calculate true values
  const totalSales = total.sales || months.reduce((s,m) => s + (m.sales||0), 0);
  const totalProfit = total.grossProfit || total.profit || months.reduce((s,m) => s + (m.grossProfit||0), 0);
  const totalCustomers = paftah.customers.length;
  
  // Expenses 2026
  let exp2026 = 0;
  if (typeof EXPENSES_DATA !== 'undefined') {
    EXPENSES_DATA.expenses.forEach(e => { if (e.date?.startsWith('2026')) exp2026 += e.amount; });
  }
  const netIncome = totalProfit - exp2026;
  
  console.log(`\n=== SYNCING HEADER VALUES ===`);
  console.log(`  المبيعات: ${totalSales.toFixed(2)} | الربح: ${totalProfit.toFixed(2)} | العملاء: ${totalCustomers}`);
  console.log(`  مصروفات 2026: ${exp2026.toFixed(2)} | صافي الدخل: ${netIncome.toFixed(2)}`);
  
  // 1. Fix "المبيعات (شامل الضريبة)"
  html = html.replace(
    /(المبيعات \(شامل الضريبة\)<\/div>\s*<div class="value[^"]*" data-count=")[0-9.]+(")/,
    `$1${totalSales.toFixed(2)}$2`
  );
  
  // 2. Fix "إجمالي الربح"
  html = html.replace(
    /(إجمالي الربح<\/div>\s*<div class="value[^"]*" data-count=")[0-9.]+(")/,
    `$1${totalProfit.toFixed(2)}$2`
  );
  
  // 3. Fix "صافي الدخل"
  html = html.replace(
    /(صافي الدخل<\/div>\s*<div class="value[^"]*" data-count=")[0-9.]+(")/,
    `$1${netIncome.toFixed(2)}$2`
  );
  
  // 4. Fix "إجمالي العملاء"
  html = html.replace(
    /(إجمالي العملاء<\/div>\s*<div class="value[^"]*" data-count=")\d+(")/,
    `$1${totalCustomers}$2`
  );
  
  console.log('✓ Synced header: المبيعات, الربح, صافي الدخل, العملاء');
}

writeFileSync(htmlPath, html, 'utf-8');
