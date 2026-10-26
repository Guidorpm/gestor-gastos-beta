const fs=require('fs'),vm=require('vm'),assert=require('assert');
(async()=>{for(const file of ['index.html','index_operator.html']){
 const src=fs.readFileSync(file,'utf8');for(const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
 const names=['uploadCreditDocument','creditStatementUploadErrorMessage','creditReceiptDiagnosticCode','creditReceiptStorageSubcode','creditReceiptStorageStatusSuffix'];
 const extract=n=>{let a=src.indexOf('function '+n+'(');assert(a>=0,n);if(src.slice(a-6,a)==='async ')a-=6;return src.slice(a,src.indexOf('\n}',a)+2)};
 let uploads=[],inserts=[],removed=[],duplicate=null,storageError=null,insertError=null,rollbackError=null;
 const ctx={console:{error:()=>{}},assertCreditWriteAllowed:()=>{},receiptFileIsAcceptable:()=>true,creditStorageOwnerId:()=> 'owner',findMatchingCreditDocument:async()=>duplicate,session:{user:{id:'u'}}};
 ctx.sb={storage:{from:()=>({
   upload:async(path,body,options)=>{uploads.push({path,body,options});if(!(body instanceof ArrayBuffer))return{error:new Error('No content provided')};return{error:storageError}},
   remove:async paths=>{removed.push(...paths);return{error:rollbackError}}
 })},from:()=>({insert:payload=>{
   inserts.push(payload);
   return {select:()=>({single:async()=>({data:insertError?null:{id:'doc'},error:insertError})})};
 }})};vm.createContext(ctx);
 vm.runInContext(src.match(/const CREDIT_RECEIPT_STAGE_CODES=\{[\s\S]*?\};/)[0]+'\n'+names.map(extract).join('\n'),ctx);
 const fileObj={name:'statement.pdf',size:4,type:'',arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer};
 const args={cardId:'card',kind:'statement'};let result=await ctx.uploadCreditDocument(fileObj,args);
 assert.equal(result.document.id,'doc');assert.equal(uploads.length,1);assert.equal(uploads[0].body.byteLength,4);assert.equal(uploads[0].options.contentType,'application/pdf');assert.equal(uploads[0].options.upsert,false);assert.equal(inserts[0].mime_type,'application/pdf');
 duplicate={file_path:'existing',id:'doc'};result=await ctx.uploadCreditDocument({...fileObj,arrayBuffer:()=>{throw Error('should not reread duplicate')}},args);assert(result.alreadyLoaded);assert.equal(uploads.length,1);duplicate=null;
 for(const bytes of [new ArrayBuffer(0),new ArrayBuffer(2)]){await assert.rejects(()=>ctx.uploadCreditDocument({...fileObj,arrayBuffer:async()=>bytes},args),e=>e.creditStage==='read_file');}assert.equal(uploads.length,1);
 await assert.rejects(()=>ctx.uploadCreditDocument({...fileObj,arrayBuffer:async()=>{throw new Error('unavailable')}},args),e=>e.creditStage==='read_file');
 storageError=new Error('No content provided');await assert.rejects(()=>ctx.uploadCreditDocument(fileObj,args),e=>e.creditStage==='storage');assert.equal(inserts.length,1);storageError=null;
 insertError=new Error('private database details');await assert.rejects(()=>ctx.uploadCreditDocument(fileObj,args),e=>e.creditStage==='insert_failed');assert.equal(removed.length,1);
 rollbackError=new Error('remove failed');await assert.rejects(()=>ctx.uploadCreditDocument(fileObj,args),e=>e.creditStage==='insert_orphaned'&&e.needsReconcile);insertError=null;rollbackError=null;
 await ctx.uploadCreditDocument({...fileObj,name:'receipt.jpg',type:'image/jpeg'},{...args,kind:'card_receipt',movementId:'payment'});assert.equal(uploads.at(-1).options.contentType,'image/jpeg');
 for(const stage of ['read_file','storage','insert_failed','insert_orphaned','unknown_after_upload']){const msg=ctx.creditStatementUploadErrorMessage({creditStage:stage,message:'secret-token-private-url'});assert(msg.includes('STATEMENT_'));assert(!msg.includes('secret-token'));assert(!msg.includes('Requiere revisión'));}
 assert(src.includes('result.error=creditStatementUploadErrorMessage(uploadError);'));
 console.log(file+': syntax, binary PDF/receipt, MIME, duplicate, empty/truncated/unreadable file, storage failure, insert rollback, orphan and safe diagnostics passed');
}})().catch(e=>{console.error(e);process.exitCode=1});
