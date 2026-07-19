const fs = require('fs');
const html = fs.readFileSync('paftah-comprehensive-report.html', 'utf8');
const dm = html.match(/const PAFTAH_DATA = (\{.*?\});\s*\n/s);
const data = JSON.parse(dm[1]);

const totalPaid = data.customers.reduce((s,c) => s + c.p, 0);
const payingCount = data.customers.filter(c => c.p > 0).length;
const top10 = data.customers.filter(c => c.p > 0).sort((a,b) => b.p - a.p).slice(0, 10);

console.log('=== PAYMENT SUMMARY ===');
console.log('Total customers with payments:', payingCount);
console.log('Total paid (sum of totalPaid):', totalPaid.toFixed(2));
console.log('\nTop 10 paying customers:');
top10.forEach((c, i) => {
  console.log(`${i+1}. ${c.n.substring(0,35).padEnd(35)} | ${c.p.toFixed(2)} ر.س | ${c.d} | ${c.ph || '-'}`);
});
