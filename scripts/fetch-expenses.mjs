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

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;
console.log('✓ Authenticated');

// Fetch ALL expenses from 2025 onwards
console.log('[1] Fetching all expenses...');
const allExpenses = [];
let offset = 0;
const limit = 100;
let total = null;

while (total === null || offset < total) {
  const res = await fetch(`${API_BASE}/expense-service/expenses?offset=${offset}&limit=${limit}&search=&sortOn=createdAt&sortBy=DESC&amount=&taxAmount=&createdAtFrom=2024-01-01&createdAtTo=2026-12-31`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  });
  if (!res.ok) { console.log(`API returned ${res.status}`); break; }
  const data = await res.json();
  
  if (total === null) {
    total = data.total || data.meta?.total || data.resultSet?.length || data.data?.length || 0;
    console.log(`  Total expenses: ${total}`);
  }
  
  const expenses = data.data || data.resultSet || [];
  if (expenses.length === 0) break;
  
  for (const e of expenses) {
    allExpenses.push({
      id: e.id,
      number: e.number || e.reference || '',
      date: (e.createdAt || e.date).substring(0, 10),
      description: e.description || e.note || e.name || '',
      category: e.category?.name || e.categoryName || e.category || '',
      amount: parseFloat(e.amount || e.totalAmount || 0),
      taxAmount: parseFloat(e.taxAmount || 0),
      total: parseFloat(e.amount || 0) + parseFloat(e.taxAmount || 0),
      vendor: e.vendor?.name || e.payee || e.supplier || '',
      paymentMethod: e.paymentMethod || e.paymentType || '',
      recurring: e.isRecurring || e.recurring || false,
    });
  }
  
  offset += limit;
  console.log(`  Fetched ${allExpenses.length}/${total}`);
  if (expenses.length < limit) break;
}

console.log(`\nTotal fetched: ${allExpenses.length}`);

// Sort by date
allExpenses.sort((a, b) => a.date.localeCompare(b.date));

// Show summary
console.log(`\n=== EXPENSE SUMMARY ===`);
console.log(`First: ${allExpenses[0]?.date} - ${allExpenses[0]?.description}`);
console.log(`Last: ${allExpenses[allExpenses.length-1]?.date} - ${allExpenses[allExpenses.length-1]?.description}`);
console.log(`Total amount: ${allExpenses.reduce((s,e) => s + e.amount, 0).toFixed(2)}`);

// By category
const byCategory = {};
allExpenses.forEach(e => {
  const cat = e.category || 'غير مصنف';
  if (!byCategory[cat]) byCategory[cat] = { count: 0, total: 0 };
  byCategory[cat].count++;
  byCategory[cat].total += e.amount;
});
console.log(`\n=== BY CATEGORY ===`);
Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total).forEach(([cat, info]) => {
  console.log(`  ${cat}: ${info.count} سند، ${info.total.toFixed(2)} ر.س`);
});

// By month
const byMonth = {};
allExpenses.forEach(e => {
  const m = e.date.substring(0, 7);
  if (!byMonth[m]) byMonth[m] = { count: 0, total: 0 };
  byMonth[m].count++;
  byMonth[m].total += e.amount;
});
console.log(`\n=== BY MONTH ===`);
Object.entries(byMonth).sort().forEach(([m, info]) => {
  console.log(`  ${m}: ${info.count} سند، ${info.total.toFixed(2)} ر.س`);
});

// Build data for HTML
const expensesData = {
  total: allExpenses.length,
  totalAmount: +allExpenses.reduce((s,e) => s + e.amount, 0).toFixed(2),
  totalTax: +allExpenses.reduce((s,e) => s + e.taxAmount, 0).toFixed(2),
  categories: Object.entries(byCategory).sort((a, b) => b[1].total - a[1].total).map(([name, info]) => ({
    name, count: info.count, total: +info.total.toFixed(2),
  })),
  monthly: Object.entries(byMonth).sort().map(([month, info]) => ({
    month, count: info.count, total: +info.total.toFixed(2),
  })),
  expenses: allExpenses.map(e => ({
    number: e.number,
    date: e.date,
    description: e.description,
    category: e.category,
    amount: +e.amount.toFixed(2),
    taxAmount: +e.taxAmount.toFixed(2),
    total: +e.total.toFixed(2),
    vendor: e.vendor,
  })),
};

// Inject into HTML
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst EXPENSES_DATA = .*?;\n/g, '\n');
const dataStr = '\nconst EXPENSES_DATA = ' + JSON.stringify(expensesData) + ';\n';
const idx = html.indexOf('// ===== TAXES TAB');
if (idx > -1) html = html.substring(0, idx) + dataStr + html.substring(idx);
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Expenses data injected');
