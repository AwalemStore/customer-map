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

// Fetch monthly stats
const months = [];
for (let m = 1; m <= 7; m++) {
  const start = new Date(Date.UTC(2026, m-1, 1)); start.setUTCHours(start.getUTCHours() - 3);
  const end = new Date(Date.UTC(2026, m, 1)); end.setUTCHours(end.getUTCHours() - 3); end.setUTCMilliseconds(-1);
  const res = await fetch(`${API_BASE}/reporting-bridge/dashboard/stats?startDate=${start.toISOString()}&endDate=${end.toISOString()}&branches=1,2,3&currentMonth=true&isAccountingInstalled=true&startTime=00:00:00&endTime=23:59:59&timezone=Asia/Riyadh`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  const stats = await res.json();
  months.push({ month: m, sales: stats.totalSales, count: stats.salesCount, profit: stats.grossProfit });
}

// === ANALYSIS ===
const insights = {};

// 1. Cash flow analysis
const totalSales = months.reduce((s,m) => s + m.sales, 0);
const totalProfit = months.reduce((s,m) => s + m.profit, 0);
const totalDebt = customers.reduce((s,c) => s + (c.debitAmount || 0), 0);
const totalPaid = customers.reduce((s,c) => s + (c.totalPaid || 0), 0);
const collectionRate = (totalPaid / totalSales * 100).toFixed(1);

// 2. Debt risk analysis
const debtors = customers.filter(c => c.debitAmount > 0);
const bigDebtors = customers.filter(c => c.debitAmount >= 1000).sort((a,b) => b.debitAmount - a.debitAmount);
const noPayDebtors = customers.filter(c => c.debitAmount > 0 && c.totalPaid === 0);
const noPayDebt = noPayDebtors.reduce((s,c) => s + c.debitAmount, 0);

// 3. Monthly trend
const monthNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو'];
const trend = months.map((m, i) => {
  const prev = i > 0 ? months[i-1].sales : 0;
  const growth = prev > 0 ? ((m.sales - prev) / prev * 100).toFixed(0) : null;
  return { name: monthNames[m.month-1], sales: m.sales, count: m.count, avg: m.count > 0 ? m.sales / m.count : 0, growth };
});

// 4. Best/worst months
const bestMonth = months.reduce((a, b) => a.sales > b.sales ? a : b);
const worstMonth = months.filter(m => m.sales > 0).reduce((a, b) => a.sales < b.sales ? a : b);

// 5. Customer concentration
const topCustomer = bigDebtors[0];
const topPct = topCustomer ? (topCustomer.debitAmount / totalDebt * 100).toFixed(1) : 0;

// 6. Break-even analysis
const avgMonthlySales = totalSales / months.filter(m => m.sales > 0).length;
const avgProfitMargin = (totalProfit / totalSales * 100).toFixed(1);

// 7. Top paying customers
const topPayers = customers.filter(c => c.totalPaid > 0).sort((a,b) => b.totalPaid - a.totalPaid).slice(0, 10);

// 8. Churned customers (bought before but no recent activity)
const allWithDebt = customers.filter(c => c.debitAmount > 0 && c.totalPaid === 0).length;

// 9. Collection forecast
const ifCollect30 = totalDebt * 0.3;
const ifCollect50 = totalDebt * 0.5;

// 10. Product mix recommendation
const productAnalysis = {
  bestSeller: 'مسحوق غسيل بفتة 1 كيلو (910 وحدة)',
  slowMover: '4-مسحوق غسيل 2.5 كيلو (6 وحدات)',
  inventoryValue: 75272.35,
  turnoverRisk: 'مرتفع - المخزون أكبر من المبيعات الشهرية'
};

// Build insights object
insights.summary = {
  totalSales, totalProfit, totalDebt, totalPaid, collectionRate,
  customerCount: customers.length, debtorCount: debtors.length,
  bigDebtorCount: bigDebtors.length, noPayCount: noPayDebtors.length, noPayDebt,
  avgMonthlySales, avgProfitMargin,
};

insights.alerts = [];

// Critical alerts
if (totalDebt > totalSales * 0.5) insights.alerts.push({ level: 'critical', text: `الديون (${totalDebt.toFixed(0)} ر.س) تمثل ${(totalDebt/totalSales*100).toFixed(0)}% من المبيعات — خطر سيولة` });
if (topPct > 20) insights.alerts.push({ level: 'critical', text: `عميل واحد (${topCustomer?.name}) يمثل ${topPct}% من الديون — خطر تركيز` });
if (noPayDebt > 50000) insights.alerts.push({ level: 'critical', text: `${noPayDebtors.length} عميل مديونيتهم ${noPayDebt.toFixed(0)} ر.س بدون أي سداد — ديون مشكوك فيها` });

// Warnings
const lastMonth = months[months.length - 1];
const prevMonth = months[months.length - 2];
if (prevMonth && lastMonth.sales < prevMonth.sales * 0.7) {
  insights.alerts.push({ level: 'warning', text: `تراجع المبيعات ${(100 - lastMonth.sales/prevMonth.sales*100).toFixed(0)}% عن الشهر السابق` });
}
if (collectionRate < 30) {
  insights.alerts.push({ level: 'warning', text: `نسبة التحصيل ${collectionRate}% — تحت المستوى الآمن (40%+)` });
}

// Opportunities
insights.alerts.push({ level: 'opportunity', text: `لو حصّلت 30% من الديون فقط = ${ifCollect30.toFixed(0)} ر.س تدفقة نقدية فورية` });
insights.alerts.push({ level: 'opportunity', text: `متوسط الفاتورة الأعلى كان في مارس (571 ر.س) — ركز على العملاء الكبار` });

insights.recommendations = [
  { priority: 1, title: 'حملة تحصيل فورية', desc: `ابدأ بـ ${bigDebtors.length} عميل دينهم +1000 ر.س (إجمالي ${bigDebtors.reduce((s,c) => s + c.debitAmount, 0).toFixed(0)} ر.س). استخدم تبويب واتساب لإرسال تذكيرات جماعية.`, impact: bigDebtors.reduce((s,c) => s + c.debitAmount, 0).toFixed(0) + ' ر.س محتملة' },
  { priority: 2, title: 'توقف البيع الآجل للعملاء المتعثرين', desc: `${noPayDebtors.length} عميل لم يسددوا شيئاً أبداً. حولهم للدفع النقدي أو أوقف التوريد لهم.`, impact: 'يمنع تفاقم الديون' },
  { priority: 3, title: 'استهدف متوسط فاتورة أعلى', desc: `أفضل شهر (مارس) حقق 571 ر.س متوسط فاتورة بـ 131 عملية. الشهور الأخيرة انخفضت لـ 128 ر.س. ركز على_bulk والجملة.`, impact: 'زيادة الإيرادات 40%+' },
  { priority: 4, title: 'صفحات الدفع النقدي', desc: `نسبة التحصيل ${collectionRate}% فقط. وفّر خصم 2% للدفع النقدي الفوري لتشجيع العملاء.`, impact: 'تحسين التدفق النقدي' },
  { priority: 5, title: 'مراجعة المخزون', desc: `قيمة المخزون 75,272 ر.س وهذا مرتفع مقارنة بالمبيعات. راجع المنتجات بطيئة الحركة.`, impact: 'تخفيض تكلفة التخزين' },
];

insights.topPayers = topPayers.map(c => ({ name: c.name, paid: c.totalPaid, debt: c.debitAmount }));
insights.bigDebtors = bigDebtors.slice(0, 15).map(c => ({ name: c.name, debt: c.debitAmount, paid: c.totalPaid, phone: c.mobileNumber }));
insights.monthlyTrend = trend;

console.log('=== INSIGHTS GENERATED ===');
console.log(`Alerts: ${insights.alerts.length}`);
console.log(`Recommendations: ${insights.recommendations.length}`);

// Inject into HTML
const htmlPath = join(REPO_ROOT, 'paftah-comprehensive-report.html');
let html = readFileSync(htmlPath, 'utf-8');

// Remove old insights
html = html.replace(/\nconst BUSINESS_INSIGHTS = .*?;\n/g, '\n');

const dataStr = `\nconst BUSINESS_INSIGHTS = ${JSON.stringify(insights)};\n`;
const idx = html.indexOf('// ===== Q1 RETURNS');
if (idx > -1) {
  html = html.substring(0, idx) + dataStr + html.substring(idx);
}

writeFileSync(htmlPath, html, 'utf-8');
console.log('✓ Injected business insights');
