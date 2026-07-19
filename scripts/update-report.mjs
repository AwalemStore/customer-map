import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const TIMEZONE = 'Asia/Riyadh';

const EMAIL = process.env.REWAA_EMAIL || 'info@paftah.com';
const PASSWORD = process.env.REWAA_PASSWORD;

if (!PASSWORD) {
  console.error('ERROR: REWAA_PASSWORD env var is required');
  process.exit(1);
}

async function cognitoAuth() {
  console.log('[1/7] Authenticating with Cognito...');
  const res = await fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: EMAIL, PASSWORD },
    }),
  });
  const data = await res.json();
  if (!data.AuthenticationResult?.IdToken) {
    throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  }
  console.log(`  ✓ Got token (expires in ${data.AuthenticationResult.ExpiresIn}s)`);
  return data.AuthenticationResult.IdToken;
}

function apiHeaders(token) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  };
}

async function apiFetch(token, path) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { headers: apiHeaders(token) });
  if (!res.ok) throw new Error(`API ${url} returned ${res.status}`);
  return res.json();
}

async function apiFetchSafe(token, path) {
  try {
    return await apiFetch(token, path);
  } catch (e) {
    console.log(`  ⚠ ${e.message} — skipping`);
    return null;
  }
}

function monthRange(year, month) {
  const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  startDate.setUTCHours(startDate.getUTCHours() - 3);
  const endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  endDate.setUTCHours(endDate.getUTCHours() - 3);
  endDate.setUTCMilliseconds(endDate.getUTCMilliseconds() - 1);
  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}

const AR_MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

async function fetchMonthlyStats(token) {
  console.log('[2/7] Fetching monthly stats...');
  const months = [];
  const currentMonth = new Date().getUTCMonth() + 1;
  for (let m = 1; m <= currentMonth; m++) {
    const { startDate, endDate } = monthRange(2026, m);
    const path = `/reporting-bridge/dashboard/stats?startDate=${startDate}&endDate=${endDate}&branches=1,2,3&currentMonth=true&isAccountingInstalled=true&startTime=00:00:00&endTime=23:59:59&timezone=${TIMEZONE}`;
    const stats = await apiFetchSafe(token, path);
    if (!stats) break;
    months.push({ month: m, year: 2026, ...stats });
    console.log(`  ✓ Month ${m}: sales=${stats.totalSales}, count=${stats.salesCount}, profit=${stats.grossProfit}`);
  }
  return months;
}

async function fetchDailyCharts(token) {
  console.log('[3/7] Fetching daily charts...');
  const allDaily = [];
  const currentMonth = new Date().getUTCMonth() + 1;
  for (let m = 1; m <= currentMonth; m++) {
    const { startDate, endDate } = monthRange(2026, m);
    const path = `/reporting-bridge/dashboard/charts/days?startDate=${startDate}&endDate=${endDate}&timezone=${TIMEZONE}&branches=&startTime=00:00:00&endTime=23:59:59`;
    const days = await apiFetchSafe(token, path);
    if (days) allDaily.push({ month: m, days });
    console.log(`  ✓ Month ${m}: ${days ? days.length : 0} active days`);
  }
  return allDaily;
}

async function fetchPaymentMethods(token) {
  console.log('[4/7] Fetching payment methods...');
  const allPayments = [];
  const currentMonth = new Date().getUTCMonth() + 1;
  for (let m = 1; m <= currentMonth; m++) {
    const { startDate, endDate } = monthRange(2026, m);
    const path = `/reporting-bridge/dashboard/payment-methods-report?startDate=${startDate}&endDate=${endDate}&location=&timezone=${TIMEZONE}&startTime=00:00:00&endTime=23:59:59`;
    const pm = await apiFetchSafe(token, path);
    if (pm) allPayments.push({ month: m, ...pm });
    console.log(`  ✓ Month ${m}: total=${pm?.total || 'N/A'}`);
  }
  return allPayments;
}

async function fetchAllCustomers(token) {
  console.log('[5/7] Fetching all customers...');
  const allCustomers = [];
  let offset = 0;
  const limit = 50;
  let total = null;
  while (total === null || offset < total) {
    const data = await apiFetch(token, `/enigma/customers?query=&limit=${limit}&offset=${offset}&customFields=[]`);
    allCustomers.push(...data.data);
    if (total === null) total = data.meta?.total || data.data.length;
    offset += limit;
    console.log(`  ✓ Fetched ${allCustomers.length}/${total} customers`);
  }
  return allCustomers;
}

async function fetchInvoices(token) {
  console.log('[6/7] Fetching invoices...');
  const allInvoices = [];
  let offset = 0;
  const limit = 200;
  const cutoff = new Date('2025-12-31T21:00:00.000Z');
  let hasMore = true;
  let page = 0;
  while (hasMore && page < 30) {
    const data = await apiFetchSafe(token, `/enigma/invoices/latest?offset=${offset}&limit=${limit}`);
    if (!data || !data.data || data.data.length === 0) { hasMore = false; break; }
    for (const inv of data.data) {
      const d = new Date(inv.date);
      if (d <= cutoff) { hasMore = false; break; }
      allInvoices.push(inv);
    }
    offset += limit;
    page++;
    console.log(`  ✓ Fetched ${allInvoices.length} invoices (page ${page})`);
  }
  console.log(`  ✓ Total invoices: ${allInvoices.length}`);
  return allInvoices;
}

async function fetchExpensesAndInventory(token) {
  console.log('[7/7] Fetching expenses & inventory...');
  const now = new Date();
  const yearStr = now.getUTCFullYear();
  const expenses = await apiFetchSafe(token, `/expense-service/expenses?offset=0&limit=100&search=&sortOn=createdAt&sortBy=DESC&amount=&taxAmount=&createdAtFrom=2025-12-31&createdAtTo=${yearStr}-12-31`);
  const inventory = await apiFetchSafe(token, `/reporting-bridge/dashboard/v2/todays-inventory-value?locationIds=`);
  console.log(`  ✓ Expenses: ${expenses?.total || expenses?.resultSet?.length || 0} records`);
  console.log(`  ✓ Inventory value: ${inventory?.inventoryValue || 'N/A'}`);
  return { expenses, inventory };
}

function buildPaftahData(apiCustomers) {
  const cityMap = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'city-map.json'), 'utf-8'));

  const metadataMap = {};
  try {
    const metadata = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'customer-metadata.json'), 'utf-8'));
    for (const m of metadata) {
      metadataMap[m.name.trim()] = m;
    }
  } catch {}

  const customers = apiCustomers.map(c => {
    const meta = metadataMap[c.name.trim()] || {};
    return {
      n: c.name.trim(),
      t: meta.type || 'أخرى',
      d: meta.district || 'غير محدد',
      ph: (c.mobileNumber || meta.phone || '').trim(),
      p: c.totalPaid || 0,
      db: c.debitAmount || 0,
    };
  });

  const districtMap = {};
  for (const c of customers) {
    const d = c.d;
    if (!districtMap[d]) districtMap[d] = { d, c: 0, p: 0, db: 0 };
    districtMap[d].c++;
    districtMap[d].p += c.p;
    districtMap[d].db += c.db;
  }
  const districts = Object.values(districtMap).sort((a, b) => b.db - a.db);

  const types = {};
  for (const c of customers) {
    types[c.t] = (types[c.t] || 0) + 1;
  }

  return { districts, customers, types };
}

function buildInvoiceArray(apiInvoices) {
  if (!apiInvoices || apiInvoices.length === 0) return [];
  const seen = new Set();
  return apiInvoices
    .filter(inv => {
      const d = new Date(inv.date);
      if (d.getFullYear() !== 2026) return false;
      const key = inv.invoiceNumber;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(inv => ({
      date: inv.date.substring(0, 10),
      num: inv.invoiceNumber,
      type: inv.invoiceNumber.startsWith('R') ? 'return' : 'sale',
      amount: parseFloat(inv.total),
    }))
    .reverse();
}

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function updateHtmlReport(paftahData, invoiceArray, monthlyStats, inventoryValue, extrasData) {
  const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
  let html = readFileSync(htmlPath, 'utf-8');

  // --- Calculate values from API data ---
  const totalSales = monthlyStats.reduce((s, m) => s + (m.totalSales || 0), 0);
  const totalProfit = monthlyStats.reduce((s, m) => s + (m.grossProfit || 0), 0);
  const totalOps = monthlyStats.reduce((s, m) => s + (m.salesCount || 0), 0);
  const totalMargin = totalSales > 0 ? +((totalProfit / totalSales) * 100).toFixed(1) : 0;
  const totalDebt = paftahData.customers.reduce((s, c) => s + c.db, 0);
  const totalPaid = paftahData.customers.reduce((s, c) => s + c.p, 0);
  const collectionRate = totalSales > 0 ? +((totalPaid / totalSales) * 100).toFixed(1) : 0;
  const numCustomers = paftahData.customers.length;
  const numDistricts = paftahData.districts.length;
  const topDebtor = paftahData.customers.slice().sort((a, b) => b.db - a.db)[0];
  const riskConcentration = totalDebt > 0 && topDebtor ? +((topDebtor.db / totalDebt) * 100).toFixed(1) : 0;
  const lastMonth = monthlyStats[monthlyStats.length - 1];
  const prevMonth = monthlyStats[monthlyStats.length - 2];
  const salesTrend = lastMonth && prevMonth && prevMonth.totalSales > 0
    ? +(((lastMonth.totalSales - prevMonth.totalSales) / prevMonth.totalSales) * 100).toFixed(1)
    : 0;

  console.log('  --- Calculated Values ---');
  console.log(`  Total Sales: ${totalSales.toFixed(2)}`);
  console.log(`  Total Profit: ${totalProfit.toFixed(2)}`);
  console.log(`  Total Ops: ${totalOps}`);
  console.log(`  Total Debt: ${totalDebt.toFixed(2)}`);
  console.log(`  Total Paid: ${totalPaid.toFixed(2)}`);
  console.log(`  Customers: ${numCustomers}`);
  console.log(`  Districts: ${numDistricts}`);
  console.log(`  Collection Rate: ${collectionRate}%`);
  console.log(`  Risk Concentration: ${riskConcentration}%`);

  // --- Update LAST_UPDATED ---
  const now = new Date();
  const offset = 3 * 60;
  const local = new Date(now.getTime() + offset * 60 * 1000);
  const ts = local.toISOString().replace('Z', '+03:00');
  html = html.replace(/const LAST_UPDATED = "[^"]*"/, `const LAST_UPDATED = "${ts}"`);

  // --- Update subtitle dates ---
  const lastInvoice = invoiceArray.length > 0 ? invoiceArray[invoiceArray.length - 1] : null;
  const endDateObj = lastInvoice ? new Date(lastInvoice.date) : local;
  const endDateStr = `${endDateObj.getDate()} ${AR_MONTHS[endDateObj.getMonth()]} ${endDateObj.getFullYear()}`;
  html = html.replace(
    /id="subtitleDates"[^>]*>[^<]*/,
    `id="subtitleDates">جميع البيانات من منصة رواء | من 1 يناير إلى ${endDateStr}`
  );

  // --- Replace PAFTAH_DATA ---
  const dataStart = html.indexOf('const PAFTAH_DATA = ');
  const dataEnd = html.indexOf('};', dataStart) + 2;
  const newDataStr = `const PAFTAH_DATA = ${JSON.stringify(paftahData)}`;
  html = html.substring(0, dataStart) + newDataStr + ';' + html.substring(dataEnd);

  // --- Build per-month expense map from expenses API ---
  const extras = extrasData || {};
  const monthExpenses = {};
  if (extras?.expenses) {
    const expData = extras.expenses.data || extras.expenses.resultSet || extras.expenses || [];
    if (Array.isArray(expData)) {
      expData.forEach(e => {
        const amount = parseFloat(e.amount || e.totalAmount || 0);
        const d = new Date(e.createdAt || e.date);
        if (d.getFullYear() === 2026) {
          const m = d.getMonth() + 1;
          monthExpenses[m] = (monthExpenses[m] || 0) + amount;
        }
      });
    }
  }

  // --- Update PAFTAH_DATA.monthly ---
  const monthlyArr = monthlyStats
    .filter(m => (m.totalSales || 0) > 0) // skip empty months
    .map((m, i, arr) => {
    const monthName = AR_MONTHS[m.month - 1];
    const sales = m.totalSales || 0;
    const ops = m.salesCount || 0;
    const profit = m.grossProfit || 0;
    const margin = sales > 0 ? +((profit / sales) * 100).toFixed(1) : 0;
    const expenses = monthExpenses[m.month] || 0;
    const netIncome = +(profit - expenses).toFixed(2);
    const isLast = i === arr.length - 1;
    const entry = { month: monthName, sales, ops, profit, netIncome, margin };
    if (isLast && endDateObj.getDate() < 28) entry.note = `(1-${endDateObj.getDate()})`;
    return entry;
  });
  // Add total row
  const totalNet = monthlyArr.reduce((s, m) => s + m.netIncome, 0);
  monthlyArr.push({
    month: 'الإجمالي', sales: +totalSales.toFixed(2), ops: totalOps,
    profit: +totalProfit.toFixed(2), netIncome: +totalNet.toFixed(2), margin: totalMargin, isTotal: true
  });
  const monthlyStr = `PAFTAH_DATA.monthly = ${JSON.stringify(monthlyArr)};`;
  html = html.replace(/PAFTAH_DATA\.monthly = \[[\s\S]*?\];/, monthlyStr);

  // --- Invoices array is now handled by fetch-dashboard.mjs (deduplicated) ---

  // --- Update header counter data-count attributes ---
  html = html.replace(/data-count="184233\.37"/, `data-count="${totalSales.toFixed(2)}"`);
  html = html.replace(/data-count="184897\.37"/, `data-count="${totalSales.toFixed(2)}"`);
  html = html.replace(/data-count="38580\.03"/, `data-count="${totalProfit.toFixed(2)}"`);
  html = html.replace(/data-count="38710\.84"/, `data-count="${totalProfit.toFixed(2)}"`);
  html = html.replace(/data-count="-17770\.77"/, `data-count="${totalNet.toFixed(2)}"`);
  html = html.replace(/data-count="-17639\.96"/, `data-count="${totalNet.toFixed(2)}"`);
  html = html.replace(/data-count="731" data-int="1"/, `data-count="${totalOps}" data-int="1"`);
  html = html.replace(/data-count="735" data-int="1"/, `data-count="${totalOps}" data-int="1"`);
  html = html.replace(/data-count="575" data-int="1"/, `data-count="${numCustomers}" data-int="1"`);
  html = html.replace(/data-count="576" data-int="1"/, `data-count="${numCustomers}" data-int="1"`);
  if (inventoryValue) {
    html = html.replace(/data-count="26016\.30"/, `data-count="${inventoryValue.toFixed(2)}"`);
    html = html.replace(/data-count="26016\.29663573"/, `data-count="${inventoryValue.toFixed(2)}"`);
  }

  // --- Update header sub texts ---
  html = html.replace(/(\d+) حي \| \d+ مدن/, `${numDistricts} حي | 3 مدن`);

  // --- Update exec KPI values ---
  html = html.replace(/>[0-9,]+ ر\.س<\s*(?:<\/div>\s*<div class="exec-kpi-sub">نسبة التحصيل)/, `>${fmt(totalPaid)} ر.س<\n      </div>\n      <div class="exec-kpi-sub">نسبة التحصيل`);
  html = html.replace(/نسبة التحصيل [0-9.]+%/, `نسبة التحصيل ${collectionRate}%`);
  html = html.replace(/>-[0-9,]+\.[0-9]+ ر\.س<\s*(?:<\/div>\s*<div class="exec-kpi-sub">خسارة)/, `>${totalNet >= 0 ? '' : '-'}${fmt(Math.abs(totalNet))} ر.س<\n      </div>\n      <div class="exec-kpi-sub">خسارة`);
  html = html.replace(/>[0-9.]+%<\s*(?:<\/div>\s*<div class="exec-kpi-sub">عميل واحد)/, `>${riskConcentration}%<\n      </div>\n      <div class="exec-kpi-sub">عميل واحد`);
  html = html.replace(/يمثل [0-9.]+% من الديون/, `يمثل ${riskConcentration}% من الديون`);
  html = html.replace(/>-[0-9.]+%<\s*(?:<\/div>\s*<div class="exec-kpi-sub">مارس)/, `>${salesTrend > 0 ? '' : '-'}${Math.abs(salesTrend)}%<\n      </div>\n      <div class="exec-kpi-sub">مارس`);

  // --- Update smart alerts ---
  html = html.replace(/\d+[0-9,]* ر\.س = [0-9.]+% من إجمالي المديونية/, `${fmt(topDebtor ? topDebtor.db : 0)} ر.س = ${riskConcentration}% من إجمالي المديونية`);
  html = html.replace(/صافي الدخل بالسالب:.*?ر\.س/, `صافي الدخل بالسالب: ${fmt(Math.abs(totalNet))} ر.س`);

  // --- Update payment method table ---
  html = html.replace(/>144[0-9,.]+</, `>${fmt(totalDebt)}<`);

  // --- Update customer table title ---
  html = html.replace(/\(\d+ عميل\)/, `(${numCustomers} عميل)`);

  // --- Update exec summary text ---
  html = html.replace(/بلغت إجمالي مبيعات الشركة [0-9,]+ ر\.س/, `بلغت إجمالي مبيعات الشركة ${Math.round(totalSales).toLocaleString()} ر.س`);
  html = html.replace(/\d+ عملية بيع/, `${totalOps} عملية بيع`);
  html = html.replace(/ربحاً إجمالياً قدره [0-9,]+ ر\.س/, `ربحاً إجمالياً قدره ${Math.round(totalProfit).toLocaleString()} ر.س`);
  html = html.replace(/-[0-9,]+ ر\.س نتيجة/, `${totalNet >= 0 ? '' : '-'}${Math.round(Math.abs(totalNet)).toLocaleString()} ر.س نتيجة`);

  // --- Update monthly KPI cards ---
  html = html.replace(/إجمالي المبيعات[\s\S]*?kpi-value">[^<]*/, `إجمالي المبيعات</div>\n      <div class="kpi-value">${fmt(totalSales)} ر.س`);
  html = html.replace(/صافي الدخل التراكمي[\s\S]*?kpi-value"[^>]*>[^<]*/, `صافي الدخل التراكمي</div>\n      <div class="kpi-value" style="color:var(--danger)">${fmt(totalNet)} ر.س`);

  // --- Update totalSales variable in JS ---
  html = html.replace(/var totalSales = [0-9.]+;/, `var totalSales = ${totalSales.toFixed(2)};`);

  writeFileSync(htmlPath, html, 'utf-8');
  console.log(`  ✓ Updated HTML report (${(html.length / 1024).toFixed(0)} KB)`);
}

function saveRawData(data) {
  const rawPath = join(REPO_ROOT, 'data', 'raw-api-data.json');
  writeFileSync(rawPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`  ✓ Saved raw API data (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}

async function main() {
  console.log('=== Paftah Report Auto-Update ===');
  console.log(`Time: ${new Date().toISOString()}\n`);

  const token = await cognitoAuth();

  const [monthlyStats, dailyCharts, paymentMethods, apiCustomers, invoices, extras] = await Promise.all([
    fetchMonthlyStats(token),
    fetchDailyCharts(token),
    fetchPaymentMethods(token),
    fetchAllCustomers(token),
    fetchInvoices(token),
    fetchExpensesAndInventory(token),
  ]);

  console.log('\n--- Generating Report Data ---');
  const paftahData = buildPaftahData(apiCustomers);
  const invoiceArray = buildInvoiceArray(invoices);

  saveRawData({ monthlyStats, dailyCharts, paymentMethods, apiCustomers, invoices, extras });

  const inventoryValue = extras?.inventory?.inventoryValue ? parseFloat(extras.inventory.inventoryValue) : null;
  updateHtmlReport(paftahData, invoiceArray, monthlyStats, inventoryValue, extras);

  const totalSales = monthlyStats.reduce((s, m) => s + (m.totalSales || 0), 0);
  const totalDebt = apiCustomers.reduce((s, c) => s + (c.debitAmount || 0), 0);
  const totalPaid = apiCustomers.reduce((s, c) => s + (c.totalPaid || 0), 0);
  console.log(`\n=== Summary ===`);
  console.log(`Total Sales: ${totalSales.toFixed(2)}`);
  console.log(`Total Customers: ${apiCustomers.length}`);
  console.log(`Total Debt: ${totalDebt.toFixed(2)}`);
  console.log(`Total Paid: ${totalPaid.toFixed(2)}`);
  console.log(`Inventory Value: ${extras?.inventory?.inventoryValue || 'N/A'}`);
  console.log(`Total Invoices: ${invoiceArray.length}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
