const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Fetch a few invoices and show their paymentMethod values
const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=100`, {
  headers: { accept: 'application/json', authorization: `Bearer ${token}` },
});
const data = await res.json();

// Show all paymentMethod values
const pmValues = {};
data.data.forEach(inv => {
  const pm = inv.paymentMethod || 'NULL';
  pmValues[pm] = (pmValues[pm] || 0) + 1;
});
console.log('Payment Method values:', JSON.stringify(pmValues, null, 2));

// Show the المتحدون invoice specifically
const mutahidoon = data.data.find(inv => inv.customerName && inv.customerName.includes('المتحدون'));
if (mutahidoon) {
  console.log('\nالمتحدون invoice:', JSON.stringify(mutahidoon, null, 2));
} else {
  console.log('\nالمتحدون not in this page, checking all...');
}

// Show a few sample invoices with their fields
console.log('\nSample invoices (first 3):');
data.data.slice(0, 3).forEach(inv => {
  console.log(`  ${inv.invoiceNumber} | ${inv.customerName} | total=${inv.total} | paidAmount=${inv.paidAmount} | paymentMethod=${inv.paymentMethod} | type=${inv.type}`);
});
