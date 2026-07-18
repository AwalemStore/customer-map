const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Get monthly stats from stats API
const AR_MONTHS = ['','يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو'];
console.log('=== COMPARISON: Stats API vs Invoice API ===\n');

for (let m = 1; m <= 7; m++) {
  const start = new Date(Date.UTC(2026, m-1, 1)); start.setUTCHours(start.getUTCHours() - 3);
  const end = new Date(Date.UTC(2026, m, 1)); end.setUTCHours(end.getUTCHours() - 3); end.setUTCMilliseconds(-1);
  
  // Stats API
  const statsRes = await fetch(`${API_BASE}/reporting-bridge/dashboard/stats?startDate=${start.toISOString()}&endDate=${end.toISOString()}&branches=1,2,3&currentMonth=true&isAccountingInstalled=true&startTime=00:00:00&endTime=23:59:59&timezone=Asia/Riyadh`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  const stats = await statsRes.json();
  
  // Count sales invoices for this month
  let offset = 0;
  let invTotal = 0;
  let invCount = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=${offset}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.data || data.data.length === 0) break;
    for (const inv of data.data) {
      const d = new Date(inv.completionDate || inv.date);
      if (d.getFullYear() === 2026 && d.getMonth() + 1 === m) {
        if (!inv.isReturn && !inv.invoiceNumber?.startsWith('R')) {
          invTotal += parseFloat(inv.total || 0);
          invCount++;
        }
      }
      if (d.getFullYear() === 2026 && d.getMonth() + 1 < m) { hasMore = false; break; }
    }
    offset += 50;
    if (data.data.length < 50) hasMore = false;
  }
  
  const diff = stats.totalSales - invTotal;
  console.log(`${AR_MONTHS[m-1]}: Stats API=${stats.totalSales} (${stats.salesCount}) | Invoice API=${invTotal.toFixed(2)} (${invCount}) | DIFF=${diff.toFixed(2)} (${stats.salesCount - invCount} invoices)`);
}
