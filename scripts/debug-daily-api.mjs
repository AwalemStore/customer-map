const COGNITO_ENDPOINT = 'https://cognito-idp.ap-south-1.amazonaws.com/';
const CLIENT_ID = '69s79l64n4bb9g2foper08r8uq';
const API_BASE = 'https://platform.rewaatech.com/api';
const authRes = await fetch(COGNITO_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
  body: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CLIENT_ID, AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD } }),
});
const token = (await authRes.json()).AuthenticationResult.IdToken;

// Get daily charts for July 2026
const start = new Date(Date.UTC(2026, 6, 1)); start.setUTCHours(start.getUTCHours() - 3);
const end = new Date(Date.UTC(2026, 7, 1)); end.setUTCHours(end.getUTCHours() - 3);
const res = await fetch(`${API_BASE}/reporting-bridge/dashboard/charts/days?startDate=${start.toISOString()}&endDate=${end.toISOString()}&timezone=Asia/Riyadh&startTime=00:00:00&endTime=23:59:59`, { headers: { accept: 'application/json', authorization: `Bearer ${token}` } });
const data = await res.json();

console.log('=== DAILY CHARTS API (July 2026) ===');
console.log('Response type:', typeof data);
console.log('Is array:', Array.isArray(data));
console.log('Length:', data?.length);

if (Array.isArray(data) && data.length > 0) {
  console.log('\nSample entry keys:', Object.keys(data[0]));
  console.log('\nAll days:');
  data.forEach(d => {
    console.log(JSON.stringify(d));
  });
} else {
  console.log('\nFull response:', JSON.stringify(data).substring(0, 1000));
}
