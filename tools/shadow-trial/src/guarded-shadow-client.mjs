// Source-bound browser composition. No SDK/wallet imports, default fetch,
// automatic journal initialization or automatic purchase. Deploy only inside
// the trusted Aomi runtime with its existing AomiWalletKit and real SDK adapter.
import {TaskClient} from './browser-task-client.mjs';
import {hash,utf8,text,fromBase64} from './browser-crypto.mjs';
import {createShadowRequestGuard} from './support/request-guard.mjs';
import {PREPARED_POLICIES,PreparationReservationBook} from './support/authorization-policy.mjs';
const POLICY=PREPARED_POLICIES.shadow;
const CASE=Object.freeze({sender:'0x759674c35a9f34b81f420f17bd2afea04fafd0e9',token:'0x3600000000000000000000000000000000000000',spender:'0x73742278c31a76dbb0d2587d03ef92e6e2141023'});
const LIMIT=32768;
const check=(v,c)=>{if(!v)throw Error(c);};
const clone=v=>structuredClone(v);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
function fields(v,names){check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.sort().join(','),'SHADOW_FIELDS_CHANGED');return v;}
function normalized(r){return{executionKind:r.executionKind,transactionSafetyMode:r.transactionSafetyMode,intent:r.intent,chainId:String(r.chainId),sender:r.sender,payer:r.payer,calls:[],constraints:{maxOutgoingUsdcWei:'0',maxGasUnits:null,allowedTargets:[CASE.token],minimumReceived:[]}};}
const IDENTIFIER_SCHEMA=Object.freeze({$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{required:{type:'boolean'},id:{type:'string',minLength:16,maxLength:128,pattern:'^[a-zA-Z0-9_-]+$'}},required:['required']});
function decode(value){check(typeof value==='string'&&value.length<=LIMIT,'SHADOW_ENCODED_VALUE_TOO_LARGE');const bytes=fromBase64(value);check(bytes.length<=LIMIT,'SHADOW_DECODED_VALUE_TOO_LARGE');return JSON.parse(text(bytes));}
async function boundedJson(response){const reader=response.clone().body?.getReader();let chunks=[],n=0;if(reader)for(;;){const v=await reader.read();if(v.done)break;n+=v.value.length;if(n>LIMIT){await reader.cancel();throw Error('SHADOW_RESPONSE_TOO_LARGE');}chunks.push(v.value);}const bytes=new Uint8Array(n);let p=0;for(const c of chunks){bytes.set(c,p);p+=c.length;}return JSON.parse(text(bytes));}
function extensions(value,requestHash,{paymentId,now,recovery=false}={}){
 fields(value,['aomiTask','payment-identifier']);fields(value.aomiTask,['quoteId','payloadHash']);
 check(value.aomiTask.payloadHash===requestHash,'SHADOW_TASK_HASH_CHANGED');
 const quote=/^prepare_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9]+)$/i.exec(value.aomiTask.quoteId);
 check(quote&&Number.isSafeInteger(Number(quote[2])),'SHADOW_QUOTE_INVALID');
 if(!recovery)check(Number(quote[2])>now&&Number(quote[2])<=now+300,'SHADOW_QUOTE_EXPIRED_OR_CHANGED');
 const identifier=fields(value['payment-identifier'],['info','schema']);
 fields(identifier.info,paymentId?['required','id']:['required']);
 check(identifier.info.required===false&&stable(identifier.schema)===stable(IDENTIFIER_SCHEMA),'SHADOW_IDENTIFIER_SCHEMA_CHANGED');
 if(paymentId)check(/^[A-Za-z0-9_-]{16,128}$/.test(paymentId)&&identifier.info.id===paymentId,'SHADOW_PAYMENT_ID_CHANGED');
 return clone(value);
}
function typedFromAuthorization(auth){
 fields(auth,['from','to','value','validAfter','validBefore','nonce']);
 check(['value','validAfter','validBefore'].every(k=>typeof auth[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(auth[k])),'SHADOW_AUTHORIZATION_INTEGER');
 return{domain:{name:'GatewayWalletBatched',version:'1',chainId:5042002,verifyingContract:POLICY.gateway},types:{TransferWithAuthorization:[['from','address'],['to','address'],['value','uint256'],['validAfter','uint256'],['validBefore','uint256'],['nonce','bytes32']].map(([name,type])=>({name,type}))},primaryType:'TransferWithAuthorization',message:{...auth,value:BigInt(auth.value),validAfter:BigInt(auth.validAfter),validBefore:BigInt(auth.validBefore)}};
}
/** @typedef {{purchaseApproved: true, chainId: 5042002, payer: string,
 * maxPreparationFeeMicrousd: '10000', maxRetrievalFeeMicrousd: '0',
 * maxTotalFeeMicrousd: '10000', returnedTransactionExecution: false,
 * reviewReference: string}} ShadowTrialAuthorization
 */
/** Explicit dependencies are normal trusted-app functions, not a sandbox.
 * Passing an authorization record does not create user authority. Caller must
 * bind the existing approved trial and freshly qualified input first.
 */
export async function createGuardedShadowTrial({journal,payments,walletKit,recoverTypedDataAddress,fetch:baseFetch,trustedJwks,attemptId,reviewReference,authorization=/** @type {ShadowTrialAuthorization | null} */ (null),clock=()=>Math.floor(Date.now()/1000),controlledResponseLoss=false}){
 check(journal&&payments&&typeof baseFetch==='function'&&typeof recoverTypedDataAddress==='function','SHADOW_EXPLICIT_RUNTIME_REQUIRED');
 check(/^[A-Za-z0-9_.:-]{1,96}$/.test(attemptId??'')&&typeof reviewReference==='string'&&reviewReference.length>0&&reviewReference.length<=256,'SHADOW_REVIEW_REQUIRED');
 const keys=trustedJwks?.keys;check(Array.isArray(keys)&&keys.length>0&&keys.every(k=>k&&k.kty==='OKP'&&k.crv==='Ed25519'&&typeof k.kid==='string'&&!Object.hasOwn(k,'d')&&(!k.alg||k.alg==='EdDSA')&&(!k.use||k.use==='sig'))&&new Set(keys.map(k=>k.kid)).size===keys.length,'SHADOW_TRUSTED_PUBLIC_KEYS_REQUIRED');
 for(const key of keys)await crypto.subtle.importKey('jwk',key,{name:'Ed25519'},false,['verify']);
 const caseInput={...CASE,reviewReference};
 const guard=await createShadowRequestGuard(caseInput),request=freeze(JSON.parse(guard.descriptor.bodyUtf8));
 const taskHash=await hash(stable(normalized(request)));
 const armed=authorization?.purchaseApproved===true&&authorization?.chainId===5042002&&authorization?.payer?.toLowerCase()===POLICY.payer&&authorization?.maxPreparationFeeMicrousd==='10000'&&authorization?.maxRetrievalFeeMicrousd==='0'&&authorization?.maxTotalFeeMicrousd==='10000'&&authorization?.returnedTransactionExecution===false&&authorization?.reviewReference===reviewReference;
 let operation=null,busy=false,stopped=false,closed=false,offer=null,challenge=null,challengeObserved=null,signerCalls=0,paidSubmissions=0,statusReads=0,resultReads=0,lossWithheld=false,recoveryMatched=false,originalProof=null,originalJob=null;
 const fail=code=>{stopped=true;throw Error(code);};
 const now=()=>{const n=clock();check(Number.isSafeInteger(n)&&n>=600,'SHADOW_CLOCK_INVALID');return n;};
 const reservation=async typed=>({amountMicro:'10000',chainId:5042002,payer:POLICY.payer,requestDigest:guard.requestDigest.slice(2),attemptHash:await hash('attempt\0'+attemptId),nonceHash:await hash('nonce\0'+typed.message.nonce)});
 function structural(typed,selectedOffer,generated,current){return guard.reserveUnsigned({offer:selectedOffer,typedData:typed,generatedAtSeconds:generated,nowSeconds:current,attemptId,reviewReference,book:new PreparationReservationBook()});}
 async function signTypedData(typed){
  try{
   check(armed&&operation==='prepare'&&challenge&&offer&&signerCalls===0&&!stopped&&!closed,'SHADOW_SIGNING_NOT_ENABLED');
   const generated=Number(typed?.message?.validAfter+600n),observed=now();
   check(Number.isSafeInteger(generated)&&generated>=challengeObserved&&generated<=observed&&observed-challengeObserved<=30,'SHADOW_GENERATION_OUTSIDE_TRUSTED_INTERVAL');
   const checked=structural(typed,offer,generated,observed);
   check(walletKit?.identity?.address?.toLowerCase()===POLICY.payer&&typeof walletKit.signTypedData==='function','SHADOW_SELECTED_WALLET_MISMATCH');
   await journal.reserveUnsigned(await reservation(checked.typedData));
   check(!closed&&!stopped,'SHADOW_CLOSED_BEFORE_SIGNER');signerCalls++;
   const result=await walletKit.signTypedData({signer:POLICY.payer,typed_data:checked.typedData});
   check(result&&/^0x[0-9a-f]{130}$/i.test(result.signature),'SHADOW_SIGNATURE_MISSING_OR_INVALID');
   check((await recoverTypedDataAddress({...checked.typedData,signature:result.signature})).toLowerCase()===POLICY.payer,'SHADOW_SIGNATURE_WRONG_PAYER');
   check(!closed&&!stopped,'SHADOW_CLOSED_AFTER_SIGNER');
   return result.signature;
  }catch{return fail('SHADOW_SIGNING_STOPPED_RECONCILIATION_REQUIRED');}
 }
 async function validateProof(encoded,state){
  check(encoded===state.preparation.signature,'SHADOW_PROOF_DIFFERS_FROM_PRIVATE_JOURNAL');
  const p=decode(encoded);fields(p,['x402Version','resource','accepted','payload','extensions']);
  check(p.x402Version===2&&p.resource?.url===guard.descriptor.url&&p.resource?.mimeType==='application/json','SHADOW_PROOF_RESOURCE_CHANGED');
  const selected=guard.validateOffer(p.accepted);
  extensions(p.extensions,taskHash,{paymentId:state.preparation.id,now:now(),recovery:true});
  if(challenge)check(stable(p.resource)===stable(challenge.resource)&&stable(p.accepted)===stable(challenge.accepts[0])&&stable(p.extensions.aomiTask)===stable(challenge.extensions.aomiTask),'SHADOW_SIGNED_CHALLENGE_CHANGED');
  fields(p.payload,['authorization','signature']);
  check(/^0x[0-9a-f]{130}$/i.test(p.payload.signature),'SHADOW_PROOF_SIGNATURE_INVALID');
  const typed=typedFromAuthorization(p.payload.authorization),generated=Number(typed.message.validAfter+600n);
  const checked=structural(typed,selected,generated,generated); // existing-proof structural check, not a fresh signature window
  await journal.assertReservation(await reservation(checked.typedData));
  check((await recoverTypedDataAddress({...checked.typedData,signature:p.payload.signature})).toLowerCase()===POLICY.payer,'SHADOW_PROOF_WRONG_PAYER');
  return p;
 }
 const transport=async(input,init)=>{
  try{
   check(armed&&!closed&&!stopped&&operation,'SHADOW_RUNTIME_NOT_ENABLED');
   // Match exact normal-client bytes; force credentials omission at the final
   // dispatch boundary without changing body, headers or payment proof.
   const req=new Request(input,{...init,credentials:'omit'});
   // x402/fetch 2.10.0 adds this response-policy header to its retry request.
   // It carries no payment authority; remove only that exact known SDK value.
   const expose=req.headers.get('access-control-expose-headers');
   if(expose!==null){check(req.headers.has('payment-signature')&&expose==='PAYMENT-RESPONSE,X-PAYMENT-RESPONSE','SHADOW_SDK_HEADER_CHANGED');req.headers.delete('access-control-expose-headers');}
   check(req.redirect==='error'&&req.method==='POST'&&req.headers.get('content-type')==='application/json','SHADOW_REQUEST_SHAPE_CHANGED');
   check([...req.headers.keys()].every(k=>['content-type','payment-signature'].includes(k)),'SHADOW_EXTRA_HEADER');
   const state=await journal.load();check(state?.request&&JSON.stringify({...state.request,payer:state.policy.payer})===guard.descriptor.bodyUtf8,'SHADOW_JOURNAL_REQUEST_CHANGED');
   const proof=req.headers.get('payment-signature');
   if(req.url===guard.descriptor.url){
    await guard.inspectFetchRequest(req.clone(),undefined,proof?'proof-present':'unsigned');
    if(proof){
     await validateProof(proof,state);
     check(paidSubmissions<2&&(!originalProof||proof===originalProof),'SHADOW_REPLACEMENT_OR_EXTRA_PROOF');
     const decoded=decode(proof);await journal.recordProofSubmission({requestDigest:guard.requestDigest.slice(2),nonceHash:await hash('nonce\0'+decoded.payload.authorization.nonce),proofHash:await hash(proof)});
     originalProof=proof;paidSubmissions++;
    }else check(!challenge&&paidSubmissions===0,'SHADOW_UNEXPECTED_DISCOVERY_RETRY');
    const response=await baseFetch(req,{redirect:'error',credentials:'omit',signal:req.signal});
    if(!proof){
     check(response.status===402,'SHADOW_EXPECTED_CHALLENGE');const body=await boundedJson(response),header=response.headers.get('payment-required');
     fields(body,['status','stage','amountMicrousd','refundPolicy','paymentRequired']);
     check(body.status==='payment_required'&&body.stage==='preparation'&&body.amountMicrousd==='10000'&&body.refundPolicy==='paid_attempt'&&body.paymentRequired===header,'SHADOW_CHALLENGE_ENVELOPE_CHANGED');
     const h=decode(header),b=decode(body.paymentRequired);check(stable(h)===stable(b),'SHADOW_CHALLENGE_HEADER_BODY_CHANGED');
     challengeObserved=now();extensions(h.extensions,taskHash,{now:challengeObserved});
     const base={...h};delete base.extensions;offer=guard.validateChallenge(base,base);challenge=clone(h);
    }else{
     check(response.status===202,'SHADOW_PAID_JOB_NOT_202');const job=await boundedJson(response);
     check(/^[a-f0-9-]{36}$/i.test(job.quoteId)&&typeof job.retrievalToken==='string'&&job.retrievalToken.length>=32,'SHADOW_JOB_IDENTITY_INVALID');
     const origin=new URL(guard.descriptor.url).origin;
     check(job.statusUrl===`${origin}/v1/task/${job.quoteId}/status`&&job.resultUrl===`${origin}/v1/task/${job.quoteId}/result`,'SHADOW_JOB_ROUTE_CHANGED');
     if(originalJob)check(job.quoteId===originalJob.quoteId&&job.retrievalToken===originalJob.retrievalToken,'SHADOW_RECOVERY_IDENTITY_CHANGED');
     const identity=await journal.recordJobIdentity({proofHash:await hash(proof),jobIdentityHash:await hash('shadow-job-identity-v1\0'+stable({quoteId:job.quoteId,retrievalToken:job.retrievalToken}))});
     recoveryMatched=identity.matched;
     originalJob??=job;
     if(controlledResponseLoss&&operation==='prepare'&&!lossWithheld){lossWithheld=true;throw Error('SHADOW_CONTROLLED_RESPONSE_LOSS');}
    }
    return response;
   }
   check(state.job&&!proof,'SHADOW_NO_JOB_OR_RETRIEVAL_PAYMENT');
   check(typeof state.preparation?.signature==='string','SHADOW_JOB_PROOF_MISSING');
   const existingIdentity=await journal.assertJobIdentity({proofHash:await hash(state.preparation.signature),jobIdentityHash:await hash('shadow-job-identity-v1\0'+stable({quoteId:state.job.quoteId,retrievalToken:state.job.retrievalToken}))});
   recoveryMatched=existingIdentity.matched;
   check(req.url===state.job.statusUrl||req.url===state.job.resultUrl,'SHADOW_JOB_REQUEST_ROUTE');
   check(await req.clone().text()===JSON.stringify({retrievalToken:state.job.retrievalToken}),'SHADOW_JOB_CAPABILITY_CHANGED');
   if(req.url===state.job.statusUrl)check(++statusReads<=12,'SHADOW_STATUS_READ_LIMIT');else check(++resultReads<=2,'SHADOW_RESULT_READ_LIMIT');
   return await baseFetch(req,{redirect:'error',credentials:'omit',signal:req.signal});
  }catch(e){if(e?.message==='SHADOW_CONTROLLED_RESPONSE_LOSS')throw e;return fail(typeof e?.message==='string'&&/^SHADOW_[A-Z_]+$/.test(e.message)?e.message:'SHADOW_TRANSPORT_STOPPED_RECONCILIATION_REQUIRED');}
 };
 // The SDK callback asks TaskClient to save its proof before transport. Validate
 // that first write against the actual challenge, not only at dispatch: a
 // rejected SDK mutation must never become a trusted proof after page reopen.
 const guardedJournal={
  withLock:work=>journal.withLock(work),load:()=>journal.load(),
  async save(state){
   try{
    const prior=await journal.load(),proof=state?.preparation?.signature;
    if(proof){
     const saved=prior?.preparation?.signature;
     if(saved)check(proof===saved,'SHADOW_SAVED_PROOF_REPLACEMENT');
     else check(operation==='prepare'&&challenge&&signerCalls===1,'SHADOW_NEW_PROOF_WITHOUT_CHALLENGE');
     await validateProof(proof,state);
    }else check(!prior?.preparation?.signature,'SHADOW_SAVED_PROOF_REMOVED');
    return await journal.save(state);
   }catch(e){return fail(typeof e?.message==='string'&&/^SHADOW_[A-Z_]+$/.test(e.message)?e.message:'SHADOW_PROOF_SAVE_STOPPED_RECONCILIATION_REQUIRED');}
  }
 };
 const client=new TaskClient({endpoint:guard.descriptor.url,payer:POLICY.payer,recipient:POLICY.payee,maxPreparationFeeMicrousd:10000n,maxRetrievalFeeMicrousd:0n,maxTotalFeeMicrousd:10000n,trustedJwks:clone(trustedJwks),journal:guardedJournal,payments,signTypedData,fetch:transport,now});
 async function run(kind){check(armed&&!busy&&!closed&&!stopped,'SHADOW_TRIAL_NOT_ENABLED_OR_BUSY');busy=true;operation=kind;try{return kind==='prepare'?await client.prepare(request):await client[kind]();}finally{operation=null;busy=false;}}
 return Object.freeze({request,descriptor:guard.descriptor,prepare:()=>run('prepare'),recover:()=>run('recover'),status:()=>run('status'),retrieve:()=>run('retrieve'),close(){closed=true;originalProof=null;originalJob=null;challenge=null;},summary:()=>Object.freeze({armed,closed,stopped,signerCalls,paidSubmissions,statusReads,resultReads,controlledResponseWithheld:lossWithheld,recoveryIdentityMatched:recoveryMatched,liveWalletVerified:false,settlementVerified:false})});
}
