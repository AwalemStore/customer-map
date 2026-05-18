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

async function fetchMonthlyStats(token) {
  console.log('[2/7] Fetching monthly stats...');
  const months = [];
  for (let m = 1; m <= 5; m++) {
    const { startDate, endDate } = monthRange(2026, m);
    const path = `/reporting-bridge/dashboard/stats?startDate=${startDate}&endDate=${endDate}&branches=1,2,3&currentMonth=true&isAccountingInstalled=true&startTime=00:00:00&endTime=23:59:59&timezone=${TIMEZONE}`;
    const stats = await apiFetch(token, path);
    months.push({ month: m, year: 2026, ...stats });
    console.log(`  ✓ Month ${m}: sales=${stats.totalSales}, count=${stats.salesCount}, profit=${stats.grossProfit}`);
  }
  return months;
}

async function fetchDailyCharts(token) {
  console.log('[3/7] Fetching daily charts...');
  const allDaily = [];
  for (let m = 1; m <= 5; m++) {
    const { startDate, endDate } = monthRange(2026, m);
    const path = `/reporting-bridge/dashboard/charts/days?startDate=${startDate}&endDate=${endDate}&timezone=${TIMEZONE}&branches=&startTime=00:00:00&endTime=23:59:59`;
    const days = await apiFetch(token, path);
    allDaily.push({ month: m, days });
    console.log(`  ✓ Month ${m}: ${days.length} active days`);
  }
  return allDaily;
}

async function fetchPaymentMethods(token) {
  console.log('[4/7] Fetching payment methods...');
  const allPayments = [];
  for (let m = 1; m <= 5; m++) {
    const { startDate, endDate } = monthRange(2026, m);
    const path = `/reporting-bridge/dashboard/payment-methods-report?startDate=${startDate}&endDate=${endDate}&location=&timezone=${TIMEZONE}&startTime=00:00:00&endTime=23:59:59`;
    const pm = await apiFetch(token, path);
    allPayments.push({ month: m, ...pm });
    console.log(`  ✓ Month ${m}: total=${pm.total}`);
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
  console.log('[6/7] Fetching invoices (Jan-May 2026)...');
  const allInvoices = [];
  let offset = 0;
  const limit = 200;
  const cutoff = new Date('2025-12-31T21:00:00.000Z');
  let hasMore = true;
  let page = 0;
  while (hasMore && page < 30) {
    const data = await apiFetch(token, `/enigma/invoices/latest?offset=${offset}&limit=${limit}`);
    if (!data.data || data.data.length === 0) { hasMore = false; break; }
    for (const inv of data.data) {
      const d = new Date(inv.date);
      if (d <= cutoff) { hasMore = false; break; }
      allInvoices.push(inv);
    }
    offset += limit;
    page++;
    console.log(`  ✓ Fetched ${allInvoices.length} invoices (page ${page})`);
  }
  console.log(`  ✓ Total invoices (Jan-May 2026): ${allInvoices.length}`);
  return allInvoices;
}

async function fetchExpensesAndInventory(token) {
  console.log('[7/7] Fetching expenses & inventory...');
  const expenses = await apiFetch(token, `/expense-service/expenses?offset=0&limit=100&search=&sortOn=createdAt&sortBy=DESC&amount=&taxAmount=&createdAtFrom=2025-12-31&createdAtTo=2026-05-31`);
  const inventory = await apiFetch(token, `/reporting-bridge/dashboard/v2/todays-inventory-value?locationIds=`);
  console.log(`  ✓ Expenses: ${expenses.total || expenses.resultSet?.length || 0} records`);
  console.log(`  ✓ Inventory value: ${inventory.inventoryValue}`);
  return { expenses, inventory };
}

function buildPaftahData(apiCustomers, monthlyStats, dailyCharts, paymentMethods, invoices, { expenses, inventory }) {
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
  const districts = Object.values(districtMap)
    .sort((a, b) => b.db - a.db);

  const types = {};
  for (const c of customers) {
    types[c.t] = (types[c.t] || 0) + 1;
  }

  return { districts, customers, types };
}

function buildInvoiceArray(apiInvoices) {
  return apiInvoices
    .filter(inv => {
      const d = new Date(inv.date);
      return d.getFullYear() === 2026 && d.getMonth() >= 0 && d.getMonth() <= 4;
    })
    .map(inv => ({
      date: inv.date.substring(0, 10),
      num: inv.invoiceNumber,
      type: inv.invoiceNumber.startsWith('R') ? 'return' : 'sale',
      amount: parseFloat(inv.total),
    }))
    .reverse();
}

function updateHtmlReport(paftahData, invoiceArray, monthlyStats, dailyCharts, inventoryValue) {
  const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
  let html = readFileSync(htmlPath, 'utf-8');

  // Update LAST_UPDATED
  const now = new Date();
  const offset = 3 * 60;
  const local = new Date(now.getTime() + offset * 60 * 1000);
  const ts = local.toISOString().replace('Z', '+03:00');
  html = html.replace(
    /const LAST_UPDATED = "[^"]*"/,
    `const LAST_UPDATED = "${ts}"`
  );

  // Update subtitle dates
  const arMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const lastInvoice = invoiceArray.length > 0 ? invoiceArray[invoiceArray.length - 1] : null;
  const endDate = lastInvoice ? new Date(lastInvoice.date) : local;
  const endDateStr = `${endDate.getDate()} ${arMonths[endDate.getMonth()]} ${endDate.getFullYear()}`;
  html = html.replace(
    /id="subtitleDates"[^>]*>[^<]*/ ,
    `id="subtitleDates">جميع البيانات من منصة رواء | من 1 يناير إلى ${endDateStr}`
  );

  // Replace PAFTAH_DATA
  const dataStart = html.indexOf('const PAFTAH_DATA = ');
  const dataEnd = html.indexOf('};', dataStart) + 2;
  const newDataStr = `const PAFTAH_DATA = ${JSON.stringify(paftahData)}`;
  html = html.substring(0, dataStart) + newDataStr + ';' + html.substring(dataEnd);

  // Replace invoices array
  const invStart = html.indexOf('const invoices = ');
  const invEnd = html.indexOf('];', invStart) + 2;
  const newInvStr = `const invoices = ${JSON.stringify(invoiceArray)}`;
  html = html.substring(0, invStart) + newInvStr + ';' + html.substring(invEnd);

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
  const paftahData = buildPaftahData(apiCustomers, monthlyStats, dailyCharts, paymentMethods, invoices, extras);
  const invoiceArray = buildInvoiceArray(invoices);

  saveRawData({ monthlyStats, dailyCharts, paymentMethods, apiCustomers, invoices, extras });

  updateHtmlReport(paftahData, invoiceArray, monthlyStats, dailyCharts, extras.inventory.inventoryValue);

  const totalSales = monthlyStats.reduce((s, m) => s + m.totalSales, 0);
  const totalDebt = apiCustomers.reduce((s, c) => s + (c.debitAmount || 0), 0);
  console.log(`\n=== Summary ===`);
  console.log(`Total Sales (Jan-May): ${totalSales.toFixed(2)}`);
  console.log(`Total Customers: ${apiCustomers.length}`);
  console.log(`Total Debt: ${totalDebt.toFixed(2)}`);
  console.log(`Inventory Value: ${extras.inventory.inventoryValue}`);
  console.log(`Total Invoices: ${invoiceArray.length}`);
  console.log('\nDone!');
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
