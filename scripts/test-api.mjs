async function main() {
  const authRes = await fetch('https://cognito-idp.us-east-1.amazonaws.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: '69s79l64n4bb9g2foper08r8uq',
      AuthParameters: { USERNAME: 'info@paftah.com', PASSWORD: process.env.REWAA_PASSWORD }
    })
  });
  const auth = await authRes.json();
  const token = auth.AuthenticationResult.AccessToken;
  
  // Test multiple offsets
  for (const offset of [0, 100, 200, 400, 600, 800, 900]) {
    const r = await fetch(`https://platform.rewaatech.com/api/enigma/invoices?query=&limit=50&offset=${offset}`, {
      headers: { accept: 'application/json', authorization: 'Bearer ' + token }
    });
    const d = await r.json();
    const first = d.data?.[0];
    console.log(`offset=${offset}: count=${d.data?.length} | first=${first?.invoiceNumber || 'N/A'} date=${first?.completionDate?.substring(0,10) || 'N/A'} | totalCount=${d.totalCount || 'N/A'}`);
  }
  
  // Also try with sort parameter or different endpoint
  console.log('\n--- Try invoices/v2 ---');
  const r2 = await fetch(`https://platform.rewaatech.com/api/enigma/invoices/v2?limit=10&offset=0`, {
    headers: { accept: 'application/json', authorization: 'Bearer ' + token }
  });
  console.log('v2 status:', r2.status);
  if (r2.ok) {
    const d2 = await r2.json();
    console.log('v2 count:', d2.data?.length, '| totalCount:', d2.totalCount);
  }
  
  // Try without query param
  console.log('\n--- Try without query= ---');
  const r3 = await fetch(`https://platform.rewaatech.com/api/enigma/invoices?limit=10&offset=0`, {
    headers: { accept: 'application/json', authorization: 'Bearer ' + token }
  });
  const d3 = await r3.json();
  console.log('count:', d3.data?.length, '| totalCount:', d3.totalCount);
  
  // Check report/vouchers which might have all invoices
  console.log('\n--- Try report/vouchers ---');
  const r4 = await fetch(`https://platform.rewaatech.com/api/enigma/report/invoices-report?limit=10&offset=0`, {
    headers: { accept: 'application/json', authorization: 'Bearer ' + token }
  });
  console.log('invoices-report status:', r4.status);
  if (r4.ok) {
    const d4 = await r4.json();
    console.log('count:', d4.data?.length || d4.resultSet?.length, '| totalCount:', d4.totalCount);
  }
}
main().catch(e => console.error('ERROR:', e.message));
