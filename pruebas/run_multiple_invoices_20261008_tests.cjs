const fs=require('fs'),vm=require('vm'),assert=require('assert');
for(const f of ['index.html','index_operator.html']){
 const src=fs.readFileSync(f,'utf8');const names=['serviceInvoiceItemsTotal','parseMoneyField'];
 const ctx={};vm.createContext(ctx);vm.runInContext(names.map(n=>{const start=src.indexOf('function '+n+'(');assert(start>=0);return src.slice(start,src.indexOf('\n}',start)+2)}).join('\n'),ctx);
 assert.equal(ctx.serviceInvoiceItemsTotal([{amount:127214.37},{amount:29328.78}]),156543.15);
 assert.equal(ctx.serviceInvoiceItemsTotal([{amount:0.1},{amount:0.2}]),0.3);
 assert.equal(ctx.serviceInvoiceItemsTotal([{amount:200},{amount:50}])-200,50);
 assert.equal(ctx.serviceInvoiceItemsTotal([{amount:200},{amount:75}])-200,75);
 for(const amount of [NaN,Infinity,-1,0])assert.throws(()=>ctx.serviceInvoiceItemsTotal([{amount}]));
 assert.throws(()=>ctx.serviceInvoiceItemsTotal([]));
 assert.equal(ctx.parseMoneyField('29.328,78'),29328.78);
 console.log(f+': 10 pruebas de importes múltiples correctas');
}
