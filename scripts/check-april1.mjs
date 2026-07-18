const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Fetch all invoices and filter April 1
let offset = 0;
const apr1 = [];
while (true) {
  const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=${offset}`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!data.data || data.data.length === 0) break;
  for (const inv of data.data) {
    const date = (inv.completionDate || inv.date).substring(0, 10);
    if (date === '2026-04-01') {
      apr1.push({
        num: inv.invoiceNumber,
        type: inv.isReturn ? 'return' : 'sale',
        customer: (inv.customerName || '').trim(),
        total: inv.total,
        paid: inv.paidAmount,
        pm: inv.paymentMethod,
      });
    }
    if (date < '2026-04-01') break;
  }
  if (data.data.length < 50) break;
  offset += 50;
}

console.log('=== April 1 RAW INVOICES ===');
console.log(`Total: ${apr1.length}`);
let salesTotal = 0, cashSales = 0, postPay = 0, returns = 0;
apr1.forEach(inv => {
  console.log(`${inv.num} | ${inv.type.padEnd(6)} | pm=${(inv.pm||'').padEnd(10)} | total=${String(inv.total).padStart(8)} | paid=${String(inv.paid).padStart(8)} | ${inv.customer.substring(0,25)}`);
  if (inv.type === 'sale') {
    salesTotal += parseFloat(inv.total);
    if (inv.pm === 'Cash') cashSales += parseFloat(inv.total);
    if (inv.pm === 'Post Pay') postPay += parseFloat(inv.total);
  } else {
    returns += parseFloat(inv.total);
  }
});
console.log(`\nSummary:`);
console.log(`  Sales total: ${salesTotal}`);
console.log(`  Cash sales: ${cashSales}`);
console.log(`  Post Pay sales: ${postPay}`);
console.log(`  Returns: ${returns}`);
console.log(`  Net: ${salesTotal - returns}`);

// Payment methods report for April 1
const startUTC = new Date(Date.UTC(2026, 3, 1)); startUTC.setUTCHours(startUTC.getUTCHours() - 3);
const endUTC = new Date(Date.UTC(2026, 3, 1, 23, 59, 59)); endUTC.setUTCHours(endUTC.getUTCHours() - 3);
const pmRes = await fetch(`${API_BASE}/reporting-bridge/dashboard/payment-methods-report?startDate=${startUTC.toISOString()}&endDate=${endUTC.toISOString()}&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
const pmData = await pmRes.json();
console.log(`\nPayment Methods Report:`);
console.log(JSON.stringify(pmData, null, 2));
