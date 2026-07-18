import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const EMAIL = process.env.REWAA_EMAIL || 'info@paftah.com';
const PASSWORD = process.env.REWAA_PASSWORD;

if (!PASSWORD) { console.error('ERROR: REWAA_PASSWORD required'); process.exit(1); }

async function auth() {
  const res = await fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: EMAIL, PASSWORD } }),
  });
  const data = await res.json();
  return data.AuthenticationResult.IdToken;
}

async function fetchAllInvoicesQ2(token) {
  console.log('[2/3] Fetching Q2 invoices (Apr-Jun 2026)...');
  const allInvoices = [];
  let offset = 0;
  const limit = 50;
  let hasMore = true;
  
  while (hasMore) {
    const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=${limit}&offset=${offset}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
    if (!res.ok) { console.log(`API returned ${res.status}`); break; }
    const data = await res.json();
    if (!data.data || data.data.length === 0) { hasMore = false; break; }
    
    for (const inv of data.data) {
      const d = new Date(inv.completionDate || inv.date || inv.createdAt);
      // Q2 = April (3) to June (5) 2026 (0-indexed months)
      if (d.getFullYear() === 2026 && d.getMonth() >= 3 && d.getMonth() <= 5) {
        // Parse payment method - "Post Pay" = آجل (NOT actual cash collected)
        const pm = inv.paymentMethod || '';
        const isPostPay = pm === 'Post Pay' || pm === 'CustomerDebit' || pm === 'آجل';
        
        allInvoices.push({
          date: (inv.completionDate || inv.date || inv.createdAt).substring(0, 10),
          invoiceNumber: inv.invoiceNumber,
          customerName: (inv.customerName || '').trim(),
          customerId: inv.customerId,
          type: inv.isReturn || inv.invoiceNumber?.startsWith('R') ? 'return' : 'sale',
          total: parseFloat(inv.total || 0),
          paidAmount: parseFloat(inv.paidAmount || 0),
          paymentMethod: pm,
          // Actual cash collected = paidAmount ONLY if NOT Post Pay (آجل)
          actualCollected: isPostPay ? 0 : Math.max(0, parseFloat(inv.paidAmount || 0)),
          isPostPay: isPostPay,
        });
      }
      // Stop if we've gone past Q2 (invoices are sorted DESC by date)
      if (d.getFullYear() === 2026 && d.getMonth() < 3) { hasMore = false; break; }
    }
    offset += limit;
    console.log(`  ✓ Fetched ${offset} invoices, Q2 found: ${allInvoices.length}`);
    if (data.data.length < limit) hasMore = false;
  }
  
  return allInvoices;
}

function updateTaxTab(q2Invoices) {
  const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
  let html = readFileSync(htmlPath, 'utf-8');

  // Build Q2 invoice data for the tax tab
  // Only sales (not returns) with ACTUAL cash/card collection (NOT آجل/CustomerDebit)
  const q2Sales = q2Invoices.filter(i => i.type === 'sale' && i.actualCollected > 0);
  
  // Group by customer - use actualCollected instead of paidAmount
  const customerMap = {};
  q2Sales.forEach(inv => {
    const name = inv.customerName || 'غير محدد';
    if (!customerMap[name]) {
      customerMap[name] = { name, sales: [], totalPaid: 0, totalSales: 0, invoiceCount: 0, dates: [] };
    }
    customerMap[name].sales.push(inv);
    customerMap[name].totalPaid += inv.actualCollected;  // ACTUAL cash, not آجل
    customerMap[name].totalSales += inv.total;
    customerMap[name].invoiceCount++;
    customerMap[name].dates.push(inv.date);
  });

  const customers = Object.values(customerMap).sort((a, b) => b.totalPaid - a.totalPaid);
  
  // Build the Q2 data JSON
  const q2Data = {
    totalCollected: customers.reduce((s, c) => s + c.totalPaid, 0),
    totalSales: customers.reduce((s, c) => s + c.totalSales, 0),
    customerCount: customers.length,
    invoiceCount: q2Sales.length,
    vatAmount: customers.reduce((s, c) => s + c.totalPaid * 15 / 115, 0),
    netAmount: customers.reduce((s, c) => s + c.totalPaid * 100 / 115, 0),
    customers: customers.map(c => ({
      name: c.name,
      totalPaid: +c.totalPaid.toFixed(2),
      totalSales: +c.totalSales.toFixed(2),
      invoiceCount: c.invoiceCount,
      firstDate: c.dates.sort()[0],
      lastDate: c.dates.sort().pop(),
      vat: +(c.totalPaid * 15 / 115).toFixed(2),
      net: +(c.totalPaid * 100 / 115).toFixed(2),
    })),
  };

  console.log(`  ✓ Q2 Data: ${q2Data.customerCount} customers, ${q2Data.invoiceCount} invoices`);
  console.log(`  ✓ Total collected: ${q2Data.totalCollected.toFixed(2)}`);
  console.log(`  ✓ VAT (15%): ${q2Data.vatAmount.toFixed(2)}`);

  // Inject Q2_DATA into the HTML
  const q2DataLine = `\nconst Q2_TAX_DATA = ${JSON.stringify(q2Data)};\n`;
  
  // Remove old Q2_TAX_DATA if exists (both with and without script tags)
  html = html.replace(/<script>const Q2_TAX_DATA = .*?;<\/script>\n?/g, '');
  html = html.replace(/\nconst Q2_TAX_DATA = .*?;\n/g, '\n');
  
  // Insert before the tax functions
  const taxFuncIdx = html.indexOf('// ===== TAX TAB');
  if (taxFuncIdx > -1) {
    html = html.substring(0, taxFuncIdx) + q2DataLine + html.substring(taxFuncIdx);
  }

  // Replace the tax table render function to use Q2 data
  const oldRenderFn = html.indexOf('function renderTaxTable()');
  const oldRenderEnd = html.indexOf('// ===== TIME AGO', oldRenderFn);
  if (oldRenderFn > -1 && oldRenderEnd > -1) {
    const newRenderFn = `
// ===== TAX TAB (CASH BASIS) =====
function initTaxTab() {
  renderTaxTable();
}

function renderTaxTable() {
  var data = (typeof Q2_TAX_DATA !== 'undefined') ? Q2_TAX_DATA : null;
  if (!data || !data.customers || data.customers.length === 0) {
    document.getElementById('taxTableBody').innerHTML = '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-secondary)">لا توجد بيانات Q2 متاحة حالياً</td></tr>';
    return;
  }

  var search = (document.getElementById('taxSearch')?.value || '').toLowerCase().trim();
  var typeF = document.getElementById('taxTypeFilter')?.value || 'all';
  var distF = document.getElementById('taxDistrictFilter')?.value || 'all';
  var minAmt = parseFloat(document.getElementById('taxMinAmount')?.value) || 0;
  var maxAmt = parseFloat(document.getElementById('taxMaxAmount')?.value) || Infinity;

  // Build customer lookup from PAFTAH_DATA for type/district
  var custMap = {};
  PAFTAH_DATA.customers.forEach(function(c) { custMap[c.n] = c; });

  var customers = data.customers.filter(function(c) {
    var meta = custMap[c.name] || {};
    var type = meta.t || 'أخرى';
    var district = meta.d || 'غير محدد';
    if (typeF !== 'all' && type !== typeF) return false;
    if (distF !== 'all' && district !== distF) return false;
    if (c.totalPaid < minAmt) return false;
    if (c.totalPaid > maxAmt) return false;
    if (search) {
      return c.name.toLowerCase().includes(search) || district.toLowerCase().includes(search) || (meta.ph && meta.ph.includes(search));
    }
    return true;
  });

  var html = '';
  var totalPaid = 0, totalVAT = 0, totalNet = 0;

  customers.forEach(function(c, i) {
    var meta = custMap[c.name] || {};
    var type = meta.t || 'أخرى';
    var district = meta.d || 'غير محدد';
    var phone = meta.ph || '-';
    var vat = c.totalPaid * 15 / 115;
    var net = c.totalPaid * 100 / 115;
    totalPaid += c.totalPaid;
    totalVAT += vat;
    totalNet += net;

    html += '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td style="font-weight:500">' + c.name + '</td>' +
      '<td><span style="display:inline-block;padding:3px 10px;border-radius:100px;font-size:0.7rem;font-weight:600;background:' + typeColor(type, 'bg') + ';color:' + typeColor(type, 'fg') + '">' + type + '</span></td>' +
      '<td>' + district + '</td>' +
      '<td>' + phone + '</td>' +
      '<td style="font-weight:700;color:var(--success)">' + fmt(c.totalPaid) + '</td>' +
      '<td style="color:var(--warning);font-weight:600">' + fmt(vat) + '</td>' +
      '<td>' + fmt(net) + '</td>' +
      '<td style="font-size:0.72rem;color:var(--text-secondary)">' + c.invoiceCount + ' فاتورة<br>' + c.firstDate + ' ← ' + c.lastDate + '</td>' +
      '</tr>';
  });

  document.getElementById('taxTableBody').innerHTML = html || '<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-secondary)">لا توجد نتائج</td></tr>';

  // Update footer totals
  document.getElementById('taxTotalPaid').textContent = fmt(totalPaid);
  document.getElementById('taxTotalVAT').textContent = fmt(totalVAT);
  document.getElementById('taxTotalNet').textContent = fmt(totalNet);

  // Update result count
  document.getElementById('taxFilterCount').innerHTML = 'عملاء Q2 (أبريل-يونيو): <strong>' + customers.length + '</strong> | فواتير محصّلة: <strong>' + data.invoiceCount + '</strong> | المحصّل: <strong>' + fmt(totalPaid) + ' ر.س</strong>';

  // Update KPIs
  document.getElementById('taxTotalCollected').textContent = fmt(totalPaid) + ' ر.س';
  document.getElementById('taxPayingCount').textContent = customers.length;
  document.getElementById('taxVATAmount').textContent = fmt(totalVAT) + ' ر.س';
  document.getElementById('taxNetAmount').textContent = fmt(totalNet) + ' ر.س';
}

function recalcTaxTotals() { renderTaxTable(); }

function clearTaxFilters() {
  document.getElementById('taxSearch').value = '';
  if (document.getElementById('taxTypeFilter')) document.getElementById('taxTypeFilter').value = 'all';
  if (document.getElementById('taxDistrictFilter')) document.getElementById('taxDistrictFilter').value = 'all';
  document.getElementById('taxMinAmount').value = '';
  document.getElementById('taxMaxAmount').value = '';
  renderTaxTable();
}

function exportTaxCSV() {
  var data = (typeof Q2_TAX_DATA !== 'undefined') ? Q2_TAX_DATA : null;
  if (!data) return;
  var custMap = {};
  PAFTAH_DATA.customers.forEach(function(c) { custMap[c.n] = c; });
  var csv = '\\uFEFFالعميل,النوع,الحي,الهاتف,المبلغ المحصّل,الضريبة 15%,الصافي,عدد الفواتير,أول فاتورة,آخر فاتورة\\n';
  data.customers.forEach(function(c) {
    var meta = custMap[c.name] || {};
    var vat = (c.totalPaid * 15 / 115).toFixed(2);
    var net = (c.totalPaid * 100 / 115).toFixed(2);
    csv += '"' + c.name + '","' + (meta.t || '') + '","' + (meta.d || '') + '","' + (meta.ph || '') + '",' + c.totalPaid + ',' + vat + ',' + net + ',' + c.invoiceCount + ',' + c.firstDate + ',' + c.lastDate + '\\n';
  });
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tax_Q2_cash_basis_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

`;
    html = html.substring(0, oldRenderFn) + newRenderFn + html.substring(oldRenderEnd);
  }

  writeFileSync(htmlPath, html, 'utf-8');
  console.log('  ✓ Updated tax tab with Q2 invoice data');
}

async function main() {
  console.log('=== Q2 Tax Report Generator ===');
  console.log('Time: ' + new Date().toISOString() + '\\n');

  const token = await auth();
  console.log('✓ Authenticated');

  const q2Invoices = await fetchAllInvoicesQ2(token);
  console.log(`\\n[3/3] Total Q2 invoices: ${q2Invoices.length}`);
  console.log(`  Sales: ${q2Invoices.filter(i => i.type === 'sale').length}`);
  console.log(`  Returns: ${q2Invoices.filter(i => i.type === 'return').length}`);
  console.log(`  With payment: ${q2Invoices.filter(i => i.paidAmount > 0).length}`);

  updateTaxTab(q2Invoices);
  console.log('\\nDone!');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
