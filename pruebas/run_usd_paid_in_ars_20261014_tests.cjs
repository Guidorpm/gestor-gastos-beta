const fs=require('fs'),vm=require('vm'),assert=require('assert');
(async()=>{for(const file of ['index.html','index_operator.html']){
 const src=fs.readFileSync(file,'utf8');
 for(const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
 const names=['creditMovementMeta','creditMovementType','creditMovementNeedsClassification','creditTaxCode','creditDollarPerceptionCode','creditStatementMeta','creditStatementSystemMovements','creditSumSystem','creditCurrentStatementPayments','creditPesoSettlement','creditPesoSettlementError','creditPaymentStatus','creditUsdPaymentDecision','creditPaymentModel','creditUsdPaymentRecommendation','creditIsCountablePayment','creditMonthlyPaymentsForCard'];
 const ctx={creditDocumentModelItems:(s,i)=>i,creditUsdDisplayDecision:(s,m)=>m.usdPaymentDecision,creditVerifiedDocument:()=>true,roundMoney:v=>Math.round(v*100)/100,normalizeText:s=>String(s||'').toLowerCase(),creditMovements:[]};vm.createContext(ctx);
 vm.runInContext("const CREDIT_META_PREFIX='[[CREDIT_META:',CREDIT_STATEMENT_META_PREFIX='[[CREDIT_STATEMENT_META:';\n"+names.map(n=>{const start=src.indexOf('function '+n+'(');assert(start>=0,n);return src.slice(start,src.indexOf('\n}',start)+2)}).join('\n'),ctx);
 const note=meta=>'[[CREDIT_META:'+JSON.stringify(meta)+']]';
 const payment=(amount,currency='ARS',meta={})=>({id:Math.random()+'',card_id:'c',statement_id:'s',movement_date:'2026-10-13',amount:-amount,currency,notes:note({movementType:'payment',source:'manual_payment',...meta})});
 const statement={id:'s',total_ars:200000,total_usd:120,notes:JSON.stringify({currentDollarPerceptionArs:36000})};
 const tax={amount:36000,currency:'ARS',notes:note({movementType:'tax',taxCode:'RG5617'})};
 const ars=payment(200000),converted=payment(180000,'ARS',{paymentSettlement:'usd_in_ars',settledUsd:120,exchangeRate:1500});
 const model=items=>ctx.creditPaymentModel(statement,[tax,...items]);
 const near=(a,b)=>assert(Math.abs(a-b)<0.00001,`${a} != ${b}`);
 for(const payments of [[ars,converted],[converted,ars]]){
  const m=model(JSON.parse(JSON.stringify(payments)));near(m.remainingArs,0);near(m.remainingUsd,0);near(m.paidArs,380000);near(m.paidUsd,0);near(m.convertedUsd,120);near(m.eligibleForeignCurrencyPerceptionArs,0);near(m.bankArs,200000);near(m.bankUsd,120);assert.equal(m.paymentStatus.code,'paid');assert.equal(m.usdPaymentDecision,'PAID_IN_ARS');
  const rec=ctx.creditUsdPaymentRecommendation(statement,[tax,...payments]);near(rec.recommendedArs,0);near(rec.recommendedUsd,0);assert.equal(rec.perceptionTreatment,'PERCEPTION_PAYABLE');
 }
 near(model([converted]).remainingArs,200000);near(model([converted]).remainingUsd,0);near(model([ars]).remainingUsd,120);
 const direct=payment(120,'USD');near(model([direct]).eligibleForeignCurrencyPerceptionArs,36000);near(model([direct]).remainingArs,164000);
 const partial=payment(75000,'ARS',{paymentSettlement:'usd_in_ars',settledUsd:50,exchangeRate:1500});
 near(model([partial]).remainingUsd,70);near(model([partial]).remainingArs,200000);assert.equal(model([partial]).usdPaymentDecision,'PARTIAL_IN_ARS');
 const mixed=model([partial,payment(70,'USD')]);near(mixed.remainingUsd,0);near(mixed.eligibleForeignCurrencyPerceptionArs,0);
 near(ctx.creditUsdPaymentRecommendation(statement,[tax,partial],'FULL_USD').eligiblePerceptionArs,0);
 const check=ctx.creditPesoSettlementError;assert.equal(check(120,1500,180000,120),'');for(const values of [[121,1500,181500,120],[0,1500,1,120],[120,NaN,180000,120],[120,1500,216000,120],[1.111,100,111.1,120]])assert(check(...values));
 near(ctx.creditPesoSettlement([payment(1,'ARS',{paymentSettlement:'usd_in_ars',settledUsd:120,exchangeRate:1500})]).usd,0);
 ctx.creditMovements=[ars,converted];const october=ctx.creditMonthlyPaymentsForCard('c','2026')[9];near(october.ars,380000);near(october.usd,0);assert.equal(october.count,2);
 assert(src.includes('value="USD_ARS"'));assert(src.includes('creditPesoSettlementError(settlementMeta.settledUsd'));assert(src.includes('creditPaymentModel(statement,[...items,payload])'));
 const elements={};let writes=0,closed=0,lastPayload,lastStatus;
 Object.assign(ctx,{creditStatements:[{...statement,card_id:'c'}],creditCards:[{id:'c'}],creditMovementsForStatement:()=>[tax,ars],creditCardName:()=> 'Test card',creditStatementLabel:()=> 'Test period',esc:String,formatARS:v=>Number(v).toFixed(2),fmtUsd:v=>Number(v).toFixed(2),formatMoneyField:v=>Number(v).toFixed(2).replace('.',','),fileUploadButtonHtml:()=>'<input id="creditPaymentReceiptFiles">',bindPaymentAmountInput:()=>{},closeModal:()=>closed++,toast:m=>m,refreshDashboardData:async()=>{},document:{getElementById:id=>elements[id]},modal:html=>{for(const match of html.matchAll(/<(?:input|select|div|h2|label|textarea|button)\b[^>]*id="([^"]+)"[^>]*>/g))elements[match[1]]={value:match[0].match(/value="([^"]*)"/)?.[1]||'',files:[],addEventListener(type,fn){this[type]=fn;}};elements.creditPaymentCurrency.value='ARS';elements.creditPaymentMethod.value='debito';elements.creditPaymentScope.value='total';},sb:{from:table=>({insert:payload=>{writes++;lastPayload=JSON.parse(JSON.stringify(payload));return{select:()=>({single:async()=>({data:{id:'created'},error:null})})};},update:payload=>({eq:async()=>{lastStatus=payload.status;return{error:null};}})})}});
 for(const n of ['parseLocalizedPaymentAmount','buildCreditMovementNotes','openCreditPaymentModal']){const start=src.indexOf('function '+n+'(');vm.runInContext(src.slice(start,src.indexOf('\n}',start)+2),ctx);}
 ctx.creditMovementsForStatement=()=>[tax];
 ctx.openCreditPaymentModal('s');
 assert.equal(elements.creditPaymentAmount.value,'200000,00','Default total ARS');assert.equal(elements.creditPaymentAmount.readOnly,true);
 elements.creditPaymentScope.value='other';elements.creditPaymentScope.onchange();assert.equal(elements.creditPaymentAmount.value,'');assert.equal(elements.creditPaymentAmount.readOnly,false);
 elements.creditPaymentAmount.value='25000,50';elements.creditPaymentAmount.input();assert(elements.creditPaymentPreview.innerHTML.includes('25000.50'));
 elements.creditPaymentScope.value='total';elements.creditPaymentScope.onchange();assert.equal(elements.creditPaymentAmount.value,'200000,00');
 elements.creditPaymentCurrency.value='USD';elements.creditPaymentCurrency.onchange();assert.equal(elements.creditPaymentAmount.value,'120,00');
 elements.creditPaymentCurrency.value='USD_ARS';elements.creditPaymentCurrency.onchange();assert.equal(elements.creditConversionFields.hidden,false);assert.equal(elements.creditPaymentAmount.value,'');assert.equal(elements.creditPaymentAmount.readOnly,false);assert.equal(elements.creditConvertedUsd.value,'120,00');assert.equal(elements.creditConvertedUsd.readOnly,true);
 elements.creditPaymentAmount.value='180000,00';elements.creditPaymentAmount.input();near(ctx.parseLocalizedPaymentAmount(elements.creditConversionRate.value),1500);
 elements.creditPaymentScope.value='other';elements.creditPaymentScope.onchange();assert.equal(elements.creditConvertedUsd.value,'');assert.equal(elements.creditConvertedUsd.readOnly,false);assert.equal(elements.creditConversionRate.value,'');
 elements.creditConvertedUsd.value='50';elements.creditPaymentAmount.value='75000,01';elements.creditPaymentAmount.input();near(Number(elements.creditConversionRate.value.replaceAll('.','').replace(',','.')),1500.0002);
 elements.creditConvertedUsd.value='0';elements.creditConvertedUsd.input();assert.equal(elements.creditConversionRate.value,'');await elements.saveCreditPayment.onclick();assert.equal(writes,0,'Zero dollars cannot save');
 elements.creditConvertedUsd.value='121';elements.creditConvertedUsd.input();await elements.saveCreditPayment.onclick();assert.equal(writes,0,'Excess USD cannot save');
 ctx.creditMovementsForStatement=()=>[tax,ars];ctx.openCreditPaymentModal('s');elements.creditPaymentCurrency.value='USD_ARS';elements.creditPaymentCurrency.onchange();
 elements.creditPaymentAmount.value='180000,01';elements.creditPaymentAmount.input();
 // The displayed rate has six decimals; persistence must use the unrounded quotient.
 await elements.saveCreditPayment.onclick();assert.equal(writes,1);assert.equal(lastStatus,'paid');assert.equal(closed,1);assert.equal(lastPayload.currency,'ARS');near(lastPayload.amount,-180000.01);near(ctx.creditMovementMeta(lastPayload).settledUsd,120);assert.equal(ctx.creditMovementMeta(lastPayload).paymentMethod,'debito');assert.equal(ctx.creditMovementMeta(lastPayload).exchangeRate,180000.01/120);near(model([ars,lastPayload]).remainingUsd,0);
 assert(src.includes('id="creditConversionRate" type="text" readonly'));
 ctx.creditMovementsForStatement=()=>[tax,payment(50000)];ctx.openCreditPaymentModal('s');assert.equal(elements.creditPaymentAmount.value,'150000,00','Total is remaining, not original balance');
 console.log(file+': syntax, full/partial/mixed settlement, order, persistence, tax, validation, cash reporting and actual form save handlers passed');
}})().catch(e=>{console.error(e);process.exitCode=1;});
