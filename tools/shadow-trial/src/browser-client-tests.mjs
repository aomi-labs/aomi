// New browser-port tests. Every service/payment/wallet is a local synthetic
// function. Only WebCrypto attestation verification and the supplied journal
// are real. No HTTP, Para session, payable proof or transaction exists here.
import { TaskClient } from './browser-task-client.mjs';
import { hash, utf8, text, toBase64, fromBase64 } from './browser-crypto.mjs';
const PAYER='0x12216f1365b9af24015baa158cc9e0d2354088a8';
const SELLER='0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0';
const ASSET='0x3600000000000000000000000000000000000000';
const GATEWAY='0x0077777d7eba4688bdef3e311b846f25870a19b9';
const ENDPOINT='https://shadow-fixture.invalid/v1/task/build';
const NOW=1800000000;
const clone=v=>structuredClone(v);
const assert=(v,m='assertion failed')=>{if(!v)throw Error(m);};
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const b64url=v=>toBase64(v).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const response=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const request=()=>({executionKind:'eoa_transactions',transactionSafetyMode:'guarded_only',intent:'SYNTHETIC OFFLINE revocation fixture; never submit',chainId:5042002,sender:'0x'+'1'.repeat(40),payer:PAYER,constraints:{maxOutgoingUsdcWei:'0',allowedTargets:[ASSET]}});
function normalized(r){return{...r,chainId:String(r.chainId),calls:[],constraints:{maxOutgoingUsdcWei:'0',maxGasUnits:null,allowedTargets:[ASSET],minimumReceived:[]}};}
async function rejects(work,pattern){let error;try{await work();}catch(e){error=e;}assert(error&&pattern.test(error.message),'expected '+pattern+', got '+error?.message);}
function paymentRuntime(counts){
 let id=0;
 return{
  createBatchEvmScheme: signer=>signer,
  createClient(config){return{config,before:null,after:null,onBeforePaymentCreation(fn){this.before=fn;},onAfterPaymentCreation(fn){this.after=fn;}};},
  generatePaymentId(){return 'SYNTHETIC_PAYMENT_ID_'+String(++id).padStart(4,'0');},
  appendPaymentIdentifierToExtensions(ext,id){ext['payment-identifier'].info.id=id;},
  wrapFetchWithPayment(transport,client){return async(input,init)=>{
   const first=await transport(input,init);if(first.status!==402)return first;
   const required=JSON.parse(text(fromBase64(first.headers.get('payment-required'))));
   await client.before({paymentRequired:required});
   const a=required.accepts[0];
   const typed={domain:{name:'GatewayWalletBatched',version:'1',chainId:5042002,verifyingContract:GATEWAY},types:{TransferWithAuthorization:[]},primaryType:'TransferWithAuthorization',message:{from:PAYER,to:SELLER,value:BigInt(a.amount),validAfter:BigInt(NOW-600),validBefore:BigInt(NOW+604900),nonce:'0x'+'1'.repeat(64)}};
   const signature=await client.config.schemes[0].client.signTypedData(typed);
   assert(signature.startsWith('SYNTHETIC-NONPAYABLE-SIGNATURE:'),'fixture signer only');
   const payload={x402Version:2,resource:required.resource,accepted:a,extensions:required.extensions,payload:{signature,authorization:{...typed.message,value:String(typed.message.value),validAfter:String(typed.message.validAfter),validBefore:String(typed.message.validBefore)}}};
   await client.after({paymentPayload:payload});
   const req=new Request(input,init),headers=new Headers(req.headers);headers.set('payment-signature',toBase64(utf8(JSON.stringify(payload))));
   return transport(new Request(req,{headers}));
  };},
 };
}
async function environment(openJournal, settings={}){
 const dbName='shadow-offline-fixture-'+crypto.randomUUID();
 let journal=await openJournal({mode:'fixture-initialize',fixtureDatabaseName:dbName});
 const journalId=journal.journalId;
 const counts={fetches:0,signs:0,proofs:[],newPaidProofs:0,resultFetches:0};
 const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'synthetic-offline-ed25519',alg:'EdDSA',use:'sig'};
 const job={quoteId:'11111111-2222-3333-4444-555555555555',retrievalToken:'SYNTHETIC-NONCAPABILITY:offline-journal-fixture-only',status:'preparing',statusUrl:ENDPOINT.replace('/build','/11111111-2222-3333-4444-555555555555/status'),resultUrl:ENDPOINT.replace('/build','/11111111-2222-3333-4444-555555555555/result')};
 const raw=utf8('{"fixture":"SYNTHETIC unsigned result only"}');
 const required={x402Version:2,resource:{url:ENDPOINT,mimeType:'application/json'},accepts:[{scheme:'exact',network:'eip155:5042002',asset:ASSET,payTo:SELLER,amount:settings.overCap?'10001':'10000',maxTimeoutSeconds:300,extra:{name:'GatewayWalletBatched',version:'1',verifyingContract:GATEWAY,minValiditySeconds:604800}}],extensions:{aomiTask:{quoteId:'prepare_'+job.quoteId+'_'+(NOW+300),payloadHash:await hash(stable(normalized(request())))},'payment-identifier':{info:{required:false}}}};
 let lost=false;
 async function preview(){
  const nr=normalized(request()),requestHash=await hash(stable(nr));
  const summary={source:{chainId:5042002},outgoingUsdcWei:settings.retrievalFee?'1000000000000000000':'0',requestHash,payerIdentity:'payment:eip155:5042002:'+PAYER};
  const pricing={outgoing_usdc_wei:summary.outgoingUsdcWei,fee_microusd:settings.retrievalFee?'30000':'0',preparation_fee_microusd:'10000'};
  let paymentRequired=null;
  if(settings.retrievalFee){const r=clone(required);r.resource.url=job.resultUrl;r.accepts[0].amount='30000';r.extensions.aomiTask={quoteId:job.quoteId,payloadHash:await hash(raw)};paymentRequired=toBase64(utf8(JSON.stringify(r)));}
  const claims={aud:'aomi-task-artifact',sub:'wallet:eip155:5042002:'+PAYER,iat:NOW,exp:NOW+3600,quoteId:job.quoteId,request:nr,requestHash,summary,pricing,payloadHash:await hash(raw),amountMicrousd:pricing.fee_microusd,payer:PAYER,chainId:5042002,paymentRequiredHash:await hash(paymentRequired??'')};
  const head=b64url(utf8(JSON.stringify({alg:'EdDSA',kid:jwk.kid}))),body=b64url(utf8(JSON.stringify(claims)));
  const sig=new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},keys.privateKey,utf8(head+'.'+body)));
  if(settings.badAttestation)sig[0]^=1;
  return{status:'ready',quoteId:job.quoteId,request:nr,requestHash,summary,pricing,payloadHash:claims.payloadHash,expiresAt:claims.exp,paymentRequired,attestation:head+'.'+body+'.'+b64url(sig)};
 }
 const fetch=async(input,init)=>{
  const req=new Request(input,init);assert(new URL(req.url).hostname==='shadow-fixture.invalid','fixture cannot dispatch elsewhere');counts.fetches++;
  if(req.url===ENDPOINT){const proof=req.headers.get('payment-signature');
   if(!proof){const header=toBase64(utf8(JSON.stringify(required)));return response({status:'payment_required',paymentRequired:header},402,{'payment-required':header});}
   const p=JSON.parse(text(fromBase64(proof)));assert(p.payload.signature.startsWith('SYNTHETIC-NONPAYABLE-SIGNATURE:'),'nonpayable proof required');
   counts.proofs.push(proof);counts.newPaidProofs=new Set(counts.proofs).size;
   if(settings.loseFirst&&!lost){lost=true;throw Error('SYNTHETIC_CONTROLLED_RESPONSE_LOSS');}
   return response(job,202);
  }
  assert((await req.json()).retrievalToken===job.retrievalToken,'capability exact');
  if(req.url===job.statusUrl)return response(await preview());
  assert(req.url===job.resultUrl,'expected result path');counts.resultFetches++;
  return new Response(settings.badBytes?utf8('tampered'):raw,{status:200,headers:{'content-type':'application/json'}});
 };
 const options=()=>({endpoint:ENDPOINT,payer:PAYER,recipient:SELLER,maxPreparationFeeMicrousd:10000n,maxRetrievalFeeMicrousd:0n,maxTotalFeeMicrousd:10000n,trustedJwks:{keys:[jwk]},journal,payments:paymentRuntime(counts),signTypedData:async()=>{counts.signs++;return'SYNTHETIC-NONPAYABLE-SIGNATURE:fixture-only';},fetch,now:()=>NOW});
 let client=new TaskClient(options());
 return{counts,raw,dbName,journalId,get client(){return client;},get journal(){return journal;},
  async reopen(){journal.close();journal=await openJournal({mode:'fixture-reopen',fixtureDatabaseName:dbName,expectedJournalId:journalId});client=new TaskClient(options());},
  async cleanup(){journal.close();if(globalThis.indexedDB)await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(dbName);r.onsuccess=resolve;r.onerror=reject;});},
 };
}
export async function runClientTests(openJournal, report=()=>{}){
 const results=[];
 const run=async(name,settings,work)=>{let env;try{env=await environment(openJournal,settings);await work(env);results.push({name,passed:true});}catch(e){results.push({name,passed:false,error:e.message});}finally{if(env)await env.cleanup();}report(results.at(-1));};
 await run('real WebCrypto preview, zero-fee result and cached recovery',{},async e=>{assert((await e.client.prepare(request())).status==='preparing');const r=await e.client.retrieve();assert(r.status==='complete'&&text(r.bytes)===text(e.raw));await e.reopen();const recovered=await e.client.recover();assert(recovered.status==='complete'&&text(recovered.bytes)===text(e.raw));assert(e.counts.signs===1&&e.counts.resultFetches===1);});
 await run('lost response survives journal reopen with same proof and no replacement signer',{loseFirst:true},async e=>{await rejects(()=>e.client.prepare(request()),/SYNTHETIC_CONTROLLED_RESPONSE_LOSS/);await e.reopen();assert((await e.client.recover()).status==='preparing');assert((await e.client.retrieve()).status==='complete');assert(e.counts.signs===1&&e.counts.proofs.length===2&&e.counts.proofs[0]===e.counts.proofs[1]&&e.counts.newPaidProofs===1);});
 await run('changed original request rejected before more transport',{},async e=>{await e.client.prepare(request());const before=e.counts.fetches;await e.reopen();await rejects(()=>e.client.prepare({...request(),intent:'changed'}),/Existing purchase or spending policy differs/);assert(e.counts.fetches===before&&e.counts.signs===1);});
 await run('preparation charge above fixed cap rejected before signer',{overCap:true},async e=>{await rejects(()=>e.client.prepare(request()),/Payment exceeds spending limit/);assert(e.counts.signs===0);});
 await run('altered signed preview rejected',{badAttestation:true},async e=>{await e.client.prepare(request());await rejects(()=>e.client.retrieve(),/Invalid attestation signature/);assert(e.counts.resultFetches===0);});
 await run('altered artifact bytes rejected and journal retained',{badBytes:true},async e=>{await e.client.prepare(request());await rejects(()=>e.client.retrieve(),/Paid artifact hash mismatch/);assert((await e.journal.inspectSummary()).stateWritten);});
 await run('positive retrieval fee rejected without second signature',{retrievalFee:true},async e=>{await e.client.prepare(request());await rejects(()=>e.client.retrieve(),/Payment exceeds spending limit/);assert(e.counts.signs===1&&e.counts.resultFetches===0);});
 await run('recovery of empty initialized journal never starts a purchase',{},async e=>{await rejects(()=>e.client.recover(),/Existing Task journal required/);assert(e.counts.fetches===0&&e.counts.signs===0);});
 return{passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,total:results.length,results,realNetworkRequests:0,realWalletCalls:0,realPaymentProofs:0};
}
