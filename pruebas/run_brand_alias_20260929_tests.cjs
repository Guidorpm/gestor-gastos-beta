const fs=require('fs'),vm=require('vm'),assert=require('assert');
for(const file of ['index.html','index_operator.html']){
const s=fs.readFileSync(file,'utf8');
const code=['creditBrandFamily','creditIssuerFamily'].map(n=>{const a=s.indexOf('function '+n+'(');return s.slice(a,s.indexOf('\n}',a)+2)}).join('\n');
const c={normalizePlainText:x=>String(x||'').toLowerCase()};vm.createContext(c);vm.runInContext(code,c);
for(const label of ['mercado_pago','Mercado Pago','mercado-pago','MercadoPago']){assert.equal(c.creditBrandFamily(label),'mercado_pago');assert.equal(c.creditIssuerFamily(label),'mercado_pago');}
assert.equal(c.creditBrandFamily('visa'),'visa');assert.equal(c.creditBrandFamily('mastercard'),'mastercard');assert.equal(c.creditIssuerFamily('banco_provincia'),'banco_provincia');assert.equal(c.creditBrandFamily('mastermind'),'unknown');
console.log(file+': 12 pruebas de identificacion correctas');
}
