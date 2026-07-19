const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

const res = await fetch(`${API_BASE}/expense-service/expenses?offset=0&limit=5&search=&sortOn=createdAt&sortBy=DESC&amount=&taxAmount=&createdAtFrom=2024-01-01&createdAtTo=2026-12-31`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
const data = await res.json();
console.log('Response keys:', Object.keys(data));
console.log('Total:', data.total || data.meta?.total);
console.log('Data count:', data.data?.length || data.resultSet?.length);
console.log('\nFirst expense FULL:');
const first = data.data?.[0] || data.resultSet?.[0];
console.log(JSON.stringify(first, null, 2));
