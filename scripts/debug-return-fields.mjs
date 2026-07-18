const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';

const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Fetch and show a return invoice in full
const res = await fetch(`${API_BASE}/enigma/invoices?query=&limit=50&offset=350`, {
  headers: { accept: 'application/json', authorization: `Bearer ${token}` },
});
const data = await res.json();

// Find returns
const returns = data.data.filter(i => i.isReturn || i.invoiceNumber?.startsWith('R'));
console.log(`Found ${returns.length} returns in this page\n`);

returns.slice(0, 3).forEach(r => {
  console.log('=== RETURN INVOICE ===');
  console.log(JSON.stringify(r, null, 2));
  console.log('');
});

// Also show a sale for comparison
const sale = data.data.find(i => !i.isReturn && !i.invoiceNumber?.startsWith('R'));
if (sale) {
  console.log('=== SALE INVOICE (for comparison) ===');
  console.log(JSON.stringify(sale, null, 2));
}
