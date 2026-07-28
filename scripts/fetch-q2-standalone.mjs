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

// Fetch ALL invoices from Apr-Jun 2026
async function fetchQ2Invoices(token) {
  console.log('[1/3] Fetching Q2 invoices (Apr-Jun 2026)...');
  const all = [];
  let offset = 0;
  while (true) {
    const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=${offset}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.data || data.data.length === 0) break;
    for (const inv of data.data) {
      const d = new Date(inv.completionDate || inv.date);
      if (d.getFullYear() === 2026 && d.getMonth() >= 3 && d.getMonth() <= 5) {
        const pm = inv.paymentMethod || '';
        const isCredit = pm === 'Post Pay' || pm === 'CustomerDebit' || pm === 'آجل';
        all.push({
          date: (inv.completionDate || inv.date).substring(0, 10),
          num: inv.invoiceNumber,
          customer: (inv.customerName || '').trim(),
          isReturn: inv.isReturn || inv.invoiceNumber?.startsWith('R'),
          total: parseFloat(inv.total || 0),
          paidAmount: parseFloat(inv.paidAmount || 0),
          pm: pm,
          isCredit: isCredit,
        });
      }
      if (d.getFullYear() === 2026 && d.getMonth() < 3) break;
    }
    offset += 50;
    if (data.data.length < 50) break;
  }
  console.log(`  ✓ Found ${all.length} Q2 invoices`);
  return all;
}

// Fetch daily payment collections for Q2
async function fetchQ2DailyCollections(token) {
  console.log('[2/3] Fetching Q2 daily payment collections...');
  const days = [];
  for (let month = 4; month <= 6; month++) {
    const daysInMonth = new Date(2026, month, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dStr = `2026-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const next = new Date(dStr + 'T00:00:00+03:00');
      next.setDate(next.getDate() + 1);
      const path = `/reporting-bridge/dashboard/payment-methods-report?startDate=${dStr}T00:00:00%2B03:00&endDate=${next.toISOString().substring(0,10)}T00:00:00%2B03:00&location=&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59`;
      try {
        const res = await fetch(`${API_BASE}${path}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const data = await res.json();
        const cash = data.paymentMethodsValues?.find(p => p.type === 'Cash')?.total || 0;
        const debit = data.paymentMethodsValues?.find(p => p.type === 'CustomerDebit')?.total || 0;
        const card = Math.abs(data.paymentMethodsValues?.find(p => p.type === 'Card')?.total || 0);
        const softpos = data.paymentMethodsValues?.find(p => p.type === 'SoftPos')?.total || 0;
        const total = cash + debit + card + softpos;
        if (total > 0) days.push({ date: dStr, cash: +cash.toFixed(2), debit: +debit.toFixed(2), card: +card.toFixed(2), softpos: +softpos.toFixed(2), total: +total.toFixed(2) });
      } catch(e) {}
    }
    console.log(`  ✓ ${month}/2026: ${days.filter(d => d.date.startsWith('2026-' + String(month).padStart(2,'0'))).length} active days`);
  }
  return days;
}

function buildHTML(invoices, dailyCollections) {
  const sales = invoices.filter(i => !i.isReturn);
  const returns = invoices.filter(i => i.isReturn);
  
  // Cash sales = NOT credit (collected at invoice time)
  const cashSales = sales.filter(i => !i.isCredit);
  const creditSales = sales.filter(i => i.isCredit);
  
  // Returns
  const returnsByCustomer = {};
  returns.forEach(r => {
    returnsByCustomer[r.customer] = (returnsByCustomer[r.customer] || 0) + r.total;
  });
  
  // Cash sales by customer (subtract returns)
  const cashByCustomer = {};
  cashSales.forEach(i => {
    if (!cashByCustomer[i.customer]) cashByCustomer[i.customer] = { invoices: [], total: 0 };
    cashByCustomer[i.customer].invoices.push(i);
    cashByCustomer[i.customer].total += i.total;
  });
  Object.keys(cashByCustomer).forEach(c => {
    cashByCustomer[c].total = Math.max(0, cashByCustomer[c].total - (returnsByCustomer[c] || 0));
  });
  const cashCustomers = Object.entries(cashByCustomer)
    .filter(([_, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);

  const totalCash = cashCustomers.reduce((s, [_, v]) => s + v.total, 0);
  const totalReturns = returns.reduce((s, r) => s + r.total, 0);
  
  // Daily totals
  const dailyTotal = dailyCollections.reduce((s, d) => s + d.total, 0);
  const dailyCash = dailyCollections.reduce((s, d) => s + d.cash, 0);
  const dailyDebit = dailyCollections.reduce((s, d) => s + d.debit, 0);
  const dailyCard = dailyCollections.reduce((s, d) => s + d.card, 0);
  
  // Credit sales summary
  const creditTotal = creditSales.reduce((s, i) => s + i.total, 0);
  const creditByCustomer = {};
  creditSales.forEach(i => {
    if (!creditByCustomer[i.customer]) creditByCustomer[i.customer] = { invoices: [], total: 0 };
    creditByCustomer[i.customer].invoices.push(i);
    creditByCustomer[i.customer].total += i.total;
  });
  const creditCustomers = Object.entries(creditByCustomer).sort((a, b) => b[1].total - a[1].total);

  const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ضرائب Q2 2026 - بفته</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'IBM Plex Sans Arabic', 'Segoe UI', sans-serif; background: #F8F7FC; color: #1a1a2e; line-height: 1.6; }
.container { max-width: 1200px; margin: 0 auto; padding: 20px; }
h1 { font-size: 1.8rem; color: #333088; margin-bottom: 4px; }
.subtitle { color: #6B7280; font-size: 0.9rem; margin-bottom: 24px; }
.card { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
.card-title { font-size: 1.1rem; font-weight: 700; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #F3F0F8; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.kpi { padding: 20px; border-radius: 12px; text-align: center; }
.kpi.cash { background: linear-gradient(135deg, #DCFCE7, #F0FDF4); border: 1px solid #BBF7D0; }
.kpi.returns { background: linear-gradient(135deg, #FEE2E2, #FEF2F2); border: 1px solid #FECACA; }
.kpi.total { background: linear-gradient(135deg, #DBEAFE, #EFF6FF); border: 1px solid #BFDBFE; }
.kpi.vat { background: linear-gradient(135deg, #FEF3C7, #FFFBEB); border: 1px solid #FDE68A; }
.kpi-label { font-size: 0.78rem; color: #6B7280; margin-bottom: 6px; }
.kpi-value { font-size: 1.6rem; font-weight: 800; }
.kpi-sub { font-size: 0.72rem; color: #6B7280; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
th { text-align: right; padding: 10px 8px; background: #F8F7FC; font-weight: 700; color: #333088; border-bottom: 2px solid #E8E5F0; position: sticky; top: 0; }
td { padding: 8px; border-bottom: 1px solid #F3F0F8; }
tr:hover td { background: #FAFAFC; }
.amount { font-weight: 600; text-align: left; white-space: nowrap; }
.positive { color: #059669; }
.negative { color: #DC2626; }
.tag { display: inline-block; padding: 2px 10px; border-radius: 100px; font-size: 0.68rem; font-weight: 600; }
.tag-cash { background: #DCFCE7; color: #059669; }
.tag-card { background: #DBEAFE; color: #2563EB; }
.tag-credit { background: #FEF3C7; color: #D97706; }
.tag-return { background: #FEE2E2; color: #DC2626; }
.search { width: 100%; padding: 10px 14px; border: 2px solid #333088; border-radius: 8px; font-size: 14px; margin-bottom: 12px; }
.note-box { padding: 14px 18px; border-radius: 10px; background: #FEF3C7; border: 1px solid #FDE68A; font-size: 0.82rem; margin-top: 16px; }
.warning-box { padding: 14px 18px; border-radius: 10px; background: #FEE2E2; border: 1px solid #FECACA; font-size: 0.82rem; margin-top: 16px; }
.table-wrap { max-height: 600px; overflow-y: auto; border-radius: 8px; }
tfoot tr { background: #F8F7FC !important; font-weight: 800; position: sticky; bottom: 0; }
@media (max-width: 768px) { .kpi-grid { grid-template-columns: 1fr 1fr; } table { font-size: 0.72rem; } }
</style>
</head>
<body>
<div class="container">
  <h1>📊 ضرائب القيمة المضافة - Q2 2026</h1>
  <p class="subtitle">الفترة: 1 أبريل - 30 يونيو 2026 | الأساس النقدي | جميع البيانات من منصة رواء</p>
  
  <div class="kpi-grid">
    <div class="kpi cash">
      <div class="kpi-label">💵 مبيعات محصّلة (نقدي/بطاقة)</div>
      <div class="kpi-value" style="color:#059669">${fmt(totalCash)}</div>
      <div class="kpi-sub">${cashCustomers.length} عميل | ${cashSales.length} فاتورة</div>
    </div>
    <div class="kpi returns">
      <div class="kpi-label">↩️ المرتجعات</div>
      <div class="kpi-value" style="color:#DC2626">-${fmt(totalReturns)}</div>
      <div class="kpi-sub">${returns.length} فاتورة مرتجع</div>
    </div>
    <div class="kpi total">
      <div class="kpi-label">💰 صافي المحصّل</div>
      <div class="kpi-value" style="color:#333088">${fmt(Math.max(0, totalCash - totalReturns))}</div>
      <div class="kpi-sub">بعد خصم المرتجعات</div>
    </div>
    <div class="kpi vat">
      <div class="kpi-label">📋 ضريبة القيمة المضافة (15%)</div>
      <div class="kpi-value" style="color:#D97706">${fmt(Math.max(0, totalCash - totalReturns) * 15 / 115)}</div>
      <div class="kpi-sub">المبلغ × 15 ÷ 115</div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">✅ المبيعات المحصّلة في Q2 (نقدي وبطاقة)</div>
    <p style="font-size:0.82rem;color:#6B7280;margin-bottom:12px">هذه الفواتير تم بيعها وتحصيلها فوراً في نفس اليوم خلال أبريل-يونيو 2026. مضمونة 100%.</p>
    <input type="text" class="search" id="cashSearch" placeholder="🔍 بحث باسم العميل أو رقم الفاتورة..." oninput="filterTable('cashTable','cashSearch')">
    <div class="table-wrap">
      <table id="cashTable">
        <thead><tr><th>#</th><th>التاريخ</th><th>رقم الفاتورة</th><th>العميل</th><th>طريقة الدفع</th><th>المبلغ (ر.س)</th></tr></thead>
        <tbody>
          ${cashSales.sort((a,b) => a.date.localeCompare(b.date)).map((inv, i) => `
          <tr>
            <td>${i+1}</td>
            <td style="white-space:nowrap">${inv.date}</td>
            <td><code style="background:#F3F0F8;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.75rem" onclick="navigator.clipboard.writeText('${inv.num}');this.textContent='✅'">${inv.num}</code></td>
            <td style="font-weight:600">${inv.customer}</td>
            <td><span class="tag ${inv.pm === 'Cash' ? 'tag-cash' : 'tag-card'}">${inv.pm === 'Cash' ? 'نقدي' : inv.pm === 'Card' ? 'بطاقة' : inv.pm}</span></td>
            <td class="amount positive">${fmt(inv.total)}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="5">الإجمالي</td><td class="amount positive">${fmt(cashSales.reduce((s,i)=>s+i.total,0))}</td></tr></tfoot>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="card-title">↩️ المرتجعات في Q2</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>التاريخ</th><th>رقم الفاتورة</th><th>العميل</th><th>المبلغ (ر.س)</th></tr></thead>
        <tbody>
          ${returns.sort((a,b) => a.date.localeCompare(b.date)).map((r, i) => `
          <tr><td>${i+1}</td><td>${r.date}</td><td><code style="background:#FEE2E2;padding:2px 8px;border-radius:4px;font-size:0.75rem">${r.num}</code></td><td>${r.customer}</td><td class="amount negative">-${fmt(r.total)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4">الإجمالي</td><td class="amount negative">-${fmt(totalReturns)}</td></tr></tfoot>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📅 التحصيلات اليومية في Q2 (من تقارير رواء)</div>
    <p style="font-size:0.82rem;color:#6B7280;margin-bottom:12px">إجمالي ما تم تحصيله فعلياً كل يوم من منصة رواء (شامل الكاش والتحويلات والبطاقات)</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th>التاريخ</th><th>كاش</th><th>تحصيل آجل</th><th>بطاقة</th><th>رواء باي</th><th>الإجمالي</th></tr></thead>
        <tbody>
          ${dailyCollections.sort((a,b) => a.date.localeCompare(b.date)).map(d => `
          <tr><td style="font-weight:600">${d.date}</td><td class="amount positive">${d.cash > 0 ? fmt(d.cash) : '-'}</td><td class="amount">${d.debit > 0 ? fmt(d.debit) : '-'}</td><td class="amount">${d.card > 0 ? fmt(d.card) : '-'}</td><td class="amount">${d.softpos > 0 ? fmt(d.softpos) : '-'}</td><td class="amount" style="font-weight:700">${fmt(d.total)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td>الإجمالي</td><td class="amount positive">${fmt(dailyCash)}</td><td class="amount">${fmt(dailyDebit)}</td><td class="amount">${fmt(dailyCard)}</td><td>-</td><td class="amount" style="font-weight:800">${fmt(dailyTotal)}</td></tr></tfoot>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📋 مبيعات آجلة في Q2 (لم تُحصّل فوراً)</div>
    <p style="font-size:0.82rem;color:#6B7280;margin-bottom:12px">فواتير صدرت كآجل (Post Pay) في أبريل-يونيو. تحصيلها يحتاج مراجعة كشف الحساب لتحديد التاريخ الدقيق.</p>
    <input type="text" class="search" id="creditSearch" placeholder="🔍 بحث باسم العميل..." oninput="filterTable('creditTable','creditSearch')">
    <div class="table-wrap">
      <table id="creditTable">
        <thead><tr><th>#</th><th>التاريخ</th><th>رقم الفاتورة</th><th>العميل</th><th>المبلغ (ر.س)</th></tr></thead>
        <tbody>
          ${creditSales.sort((a,b) => a.date.localeCompare(b.date)).map((inv, i) => `
          <tr><td>${i+1}</td><td style="white-space:nowrap">${inv.date}</td><td><code style="background:#FEF3C7;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:0.75rem" onclick="navigator.clipboard.writeText('${inv.num}');this.textContent='✅'">${inv.num}</code></td><td style="font-weight:600">${inv.customer}</td><td class="amount">${fmt(inv.total)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4">الإجمالي الآجل</td><td class="amount">${fmt(creditTotal)}</td></tr></tfoot>
      </table>
    </div>
    <div class="warning-box">
      ⚠️ <strong>تنبيه مهم:</strong> هذه المبيعات الآجلة قد تكون تحصّلت في Q2 أو في يوليو أو لازالت غير محصّلة. 
      يجب مراجعة كشف حساب كل عميل في رواء للتأكد من تاريخ التحصيل الفعلي.
      الضريبة المستحقة = فقط ما تم تحصيله فعلياً خلال أبريل-يونيو.
    </div>
  </div>

  <div class="card">
    <div class="card-title">📌 ملخص الضريبة المستحقة</div>
    <table>
      <tr><td style="padding:12px">مبيعات محصّلة (نقدي/بطاقة)</td><td class="amount positive" style="padding:12px">${fmt(totalCash)}</td></tr>
      <tr><td style="padding:12px">(-) مرتجعات</td><td class="amount negative" style="padding:12px">-${fmt(totalReturns)}</td></tr>
      <tr style="background:#F8F7FC;font-weight:700"><td style="padding:12px">صافي المبيعات الخاضعة للضريبة</td><td class="amount" style="padding:12px">${fmt(Math.max(0, totalCash - totalReturns))}</td></tr>
      <tr><td style="padding:12px">ضريبة القيمة المضافة (15%)</td><td class="amount" style="padding:12px;color:#D97706;font-weight:700">${fmt(Math.max(0, totalCash - totalReturns) * 15 / 115)}</td></tr>
    </table>
    <div class="note-box">
      💡 <strong>ملاحظة:</strong> الضريبة محسوبة على الأساس النقدي - فقط ما تم تحصيله فعلياً.<br>
      إذا تم تحصيل مبالغ من العملاء الآجلين خلال Q2، يجب إضافتها للضريبة بعد مراجعة كشوف الحساب.
    </div>
  </div>

  <p style="text-align:center;color:#6B7280;font-size:0.78rem;margin:24px 0">
    تم إنشاء هذا التقرير من منصة رواء | ${new Date().toISOString().substring(0,10)}<br>
    جميع المبالغ بالريال السعودي وتشمل ضريبة القيمة المضافة
  </p>
</div>

<script>
function filterTable(tableId, inputId) {
  const q = document.getElementById(inputId).value.toLowerCase();
  document.querySelectorAll('#' + tableId + ' tbody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
</script>
</body>
</html>`;

  return html;
}

async function main() {
  console.log('=== Q2 Tax Standalone Report ===\n');
  const token = await auth();
  console.log('✓ Authenticated');

  const invoices = await fetchQ2Invoices(token);
  console.log(`\nQ2 invoices: ${invoices.length}`);
  console.log(`  Sales: ${invoices.filter(i => !i.isReturn).length}`);
  console.log(`  Returns: ${invoices.filter(i => i.isReturn).length}`);
  console.log(`  Cash/Card: ${invoices.filter(i => !i.isReturn && !i.isCredit).length}`);
  console.log(`  Credit: ${invoices.filter(i => !i.isReturn && i.isCredit).length}`);

  const daily = await fetchQ2DailyCollections(token);
  console.log(`\nDaily collection days: ${daily.length}`);

  const html = buildHTML(invoices, daily);
  const outPath = join(REPO_ROOT, 'q2-tax.html');
  writeFileSync(outPath, html, 'utf-8');
  console.log(`\n✓ Report saved to ${outPath}`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
