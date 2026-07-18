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

// Fetch customers
const customers = [];
for (let o = 0; o < 700; o += 50) {
  const res = await fetch(`${API_BASE}/enigma/customers?query=&limit=50&offset=${o}&customFields=[]`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!data.data) break;
  customers.push(...data.data);
  if (data.data.length < 50) break;
}
console.log(`Customers: ${customers.length}`);

// Fetch ALL invoices to get per-customer last purchase date
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
    if (d.getFullYear() === 2026) {
      allInv.push({
        customer: (inv.customerName || '').trim(),
        date: (inv.completionDate || inv.date).substring(0, 10),
        type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
        total: parseFloat(inv.total || 0),
        paid: parseFloat(inv.paidAmount || 0),
      });
    }
  }
  offset += 50;
  if (data.data.length < 50) hasMore = false;
}
console.log(`Invoices: ${allInv.length}`);

// Build per-customer invoice history
const customerHistory = {};
allInv.forEach(inv => {
  if (!customerHistory[inv.customer]) customerHistory[inv.customer] = { sales: [], lastSale: '', firstSale: '9999', totalBought: 0, totalPaid: 0 };
  if (inv.type === 'sale') {
    customerHistory[inv.customer].sales.push({ date: inv.date, total: inv.total, paid: inv.paid });
    customerHistory[inv.customer].totalBought += inv.total;
    customerHistory[inv.customer].totalPaid += inv.paid;
    if (inv.date > customerHistory[inv.customer].lastSale) customerHistory[inv.customer].lastSale = inv.date;
    if (inv.date < customerHistory[inv.customer].firstSale) customerHistory[inv.customer].firstSale = inv.date;
  }
});

// Read metadata for district/type/phone
const metaMap = {};
try {
  const meta = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'customer-metadata.json'), 'utf-8'));
  for (const m of meta) metaMap[m.name.trim()] = m;
} catch {}

// Calculate aging for each debtor
const now = new Date('2026-07-18');
const agedCustomers = customers
  .filter(c => c.debitAmount > 0)
  .map(c => {
    const name = (c.name || '').trim();
    const meta = metaMap[name] || {};
    const history = customerHistory[name] || { lastSale: '', firstSale: '', sales: [], totalBought: 0, totalPaid: 0 };
    
    // Days since last purchase
    let daysSinceLast = 999;
    if (history.lastSale) {
      daysSinceLast = Math.floor((now - new Date(history.lastSale)) / 86400000);
    }
    
    // Aging buckets based on days since last sale
    let bucket = 'current';
    let bucketColor = '#10B981';
    let bucketLabel = 'حديث (0-30 يوم)';
    if (daysSinceLast > 180) { bucket = 'critical'; bucketColor = '#DC2626'; bucketLabel = 'حرج (+180 يوم)'; }
    else if (daysSinceLast > 90) { bucket = 'old'; bucketColor = '#EF4444'; bucketLabel = 'قديم (91-180 يوم)'; }
    else if (daysSinceLast > 60) { bucket = 'aging'; bucketColor = '#F97316'; bucketLabel = 'متقادم (61-90 يوم)'; }
    else if (daysSinceLast > 30) { bucket = 'watch'; bucketColor = '#F59E0B'; bucketLabel = 'مراقبة (31-60 يوم)'; }
    
    // Risk level
    const debt = c.debitAmount || 0;
    const paid = c.totalPaid || 0;
    let risk = 'low', riskColor = '#10B981', riskLabel = 'منخفض';
    if (paid === 0 && debt > 500) { risk = 'critical'; riskColor = '#DC2626'; riskLabel = 'حرج'; }
    else if (paid === 0) { risk = 'high'; riskColor = '#EF4444'; riskLabel = 'عالي'; }
    else if (debt > paid * 3) { risk = 'medium'; riskColor = '#F59E0B'; riskLabel = 'متوسط'; }
    
    return {
      name,
      district: meta.district || 'غير محدد',
      type: meta.type || 'أخرى',
      phone: (c.mobileNumber || meta.phone || '').trim(),
      debt: +debt.toFixed(2),
      paid: +paid.toFixed(2),
      lastSale: history.lastSale,
      firstSale: history.firstSale === '9999' ? '' : history.firstSale,
      daysSinceLast,
      purchaseCount: history.sales.length,
      avgInvoice: history.sales.length > 0 ? +(history.totalBought / history.sales.length).toFixed(2) : 0,
      bucket, bucketColor, bucketLabel,
      risk, riskColor, riskLabel,
    };
  })
  .sort((a, b) => b.debt - a.debt);

// Aging summary
const buckets = {
  current: { label: 'حديث (0-30 يوم)', color: '#10B981', customers: [], totalDebt: 0 },
  watch: { label: 'مراقبة (31-60 يوم)', color: '#F59E0B', customers: [], totalDebt: 0 },
  aging: { label: 'متقادم (61-90 يوم)', color: '#F97316', customers: [], totalDebt: 0 },
  old: { label: 'قديم (91-180 يوم)', color: '#EF4444', customers: [], totalDebt: 0 },
  critical: { label: 'حرج (+180 يوم)', color: '#DC2626', customers: [], totalDebt: 0 },
};

agedCustomers.forEach(c => {
  buckets[c.bucket].customers.push(c);
  buckets[c.bucket].totalDebt += c.debt;
});

console.log('\n=== AGING SUMMARY ===');
Object.values(buckets).forEach(b => {
  console.log(`${b.label}: ${b.customers.length} عميل، ${b.totalDebt.toFixed(0)} ر.س`);
});

// Build data
const agingData = {
  summary: Object.entries(buckets).map(([key, b]) => ({
    key, label: b.label, color: b.color,
    count: b.customers.length,
    totalDebt: +b.totalDebt.toFixed(2),
    avgDebt: b.customers.length > 0 ? +(b.totalDebt / b.customers.length).toFixed(2) : 0,
  })),
  totalDebt: +agedCustomers.reduce((s, c) => s + c.debt, 0).toFixed(2),
  totalCustomers: agedCustomers.length,
  customers: agedCustomers,
};

// Inject into HTML
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/\nconst AGING_DATA = .*?;\n/g, '\n');
const dataStr = `\nconst AGING_DATA = ${JSON.stringify(agingData)};\n`;
const idx = html.indexOf('// ===== VIP CUSTOMERS');
if (idx > -1) html = html.substring(0, idx) + dataStr + html.substring(idx);
writeFileSync(htmlPath, html, 'utf-8');
console.log('\n✓ Injected aging data');
