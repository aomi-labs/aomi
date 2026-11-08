import {useEffect,useRef,useState} from 'react';
import {useAomiWalletKit} from '@aomi-labs/widget/host-composition';
import {openTrustedShadowSession,readSavedShadowRecoveryMarker} from './shadow-trial.bundle.mjs';
import {readShadowReadiness} from './shadow-trial-readiness';
import {SHADOW_PAYER,SHADOW_SENDER,SHADOW_TOKEN,SHADOW_SPENDER,SHADOW_REVIEW,SHADOW_PUBLIC_JWKS,shadowHostEnabled,shadowExistingTrialAuthorization,shadowPreparationReady,parseShadowRecoveryMarker,type ShadowReadiness} from './shadow-trial-policy';
import {shadowTrialFlag as flag} from './shadow-trial-feature';
type Session=Awaited<ReturnType<typeof openTrustedShadowSession>>;
type Marker=NonNullable<ReturnType<typeof readSavedShadowRecoveryMarker>>;

export function ShadowTrialPanel(){
  const walletKit=useAomiWalletKit();
  const session=useRef<Session|null>(null);
  const mounted=useRef(true);
  const [marker,setMarker]=useState<Marker|null>(null);
  const [busy,setBusy]=useState(false),[reviewed,setReviewed]=useState(false);
  const [readiness,setReadiness]=useState<ShadowReadiness|null>(null);
  const [acceptanceMode,setAcceptanceMode]=useState<'normal'|'withhold-first-response'>('normal');
  const [summary,setSummary]=useState<ReturnType<Session['summary']>|null>(null);
  const [message,setMessage]=useState('Review the existing Testnet trial before preparing it.');
  const origin=typeof window==='undefined'?null:window.location.origin;
  const allowed=shadowHostEnabled(flag,origin);
  useEffect(()=>{mounted.current=true;try{setMarker(readSavedShadowRecoveryMarker());}catch{setMessage('The saved recovery record could not be read. Keep this browser profile and ask Aomi to inspect the original record.');}return()=>{mounted.current=false;session.current?.close();};},[]);
  function ensureHost(){if(!shadowHostEnabled(flag,window.location.origin))throw Error('SHADOW_PANEL_DISABLED');}
  function refreshMarker(){try{const saved=readSavedShadowRecoveryMarker();if(saved)setMarker(saved);}catch{setMessage('The original recovery record is unavailable. No replacement will be created.');}}
  async function checkReadiness(){if(busy)return;ensureHost();setBusy(true);setReadiness(null);try{const checked=await readShadowReadiness(window.fetch.bind(window));if(mounted.current){setReadiness(checked);setMessage('Public readiness checks passed. Review the amount and selected payer before preparing.');}}catch{if(mounted.current)setMessage('The public readiness check stopped. No wallet action was requested. Aomi needs to verify the existing allowance and the intended payer’s Gateway Testnet balance.');}finally{if(mounted.current)setBusy(false);}}
  async function open(mode:'initialize'|'reopen'){
    ensureHost();
    let saved=mode==='reopen'?marker:null;
    if(mode==='reopen'){try{saved=readSavedShadowRecoveryMarker()??saved;}catch{/* Retain explicit original details; host rechecks storage without replacement. */}}
    if(mode==='reopen'&&!saved)throw Error('SHADOW_ORIGINAL_RECORD_REQUIRED');
    const reference=saved?.reviewReference??SHADOW_REVIEW;
    const result=await openTrustedShadowSession({mode,expectedJournalId:saved?.journalId,attemptId:saved?.attemptId??`shadow-${crypto.randomUUID()}`,reviewReference:reference,acceptanceMode,authorization:shadowExistingTrialAuthorization(reference),walletKit,fetch:window.fetch.bind(window),trustedJwks:SHADOW_PUBLIC_JWKS});
    if(!mounted.current){result.close();throw Error('SHADOW_PANEL_CLOSED');}session.current=result;refreshMarker();return result;
  }
  async function operate(kind:'prepare'|'recover'|'status'|'retrieve'){
    if(busy)return;ensureHost();
    if(kind==='prepare'){try{if(!shadowPreparationReady({flag,origin:window.location.origin,walletAddress:walletKit?.identity?.address,reviewed,hasMarker:marker!==null||readSavedShadowRecoveryMarker()!==null,busy,readiness,now:Date.now()}))throw Error('NOT_READY');}catch{setMessage('A fresh public readiness check, the exact selected payer, working storage and the reviewed terms are required.');return;}}
    setBusy(true);
    try{if(kind==='recover'&&session.current){session.current.close();session.current=null;}const handle=session.current??await open(kind==='prepare'?'initialize':'reopen');const state=await handle[kind]();if(mounted.current){setSummary(state);setMessage(state.phase==='complete'?'The verified unsigned result is ready for Aomi to inspect.':`Current status: ${state.phase.replaceAll('_',' ')}.`);}}
    catch(error){if(mounted.current){let retained=false;try{const value=(error as {recoveryMarker?:unknown})?.recoveryMarker;if(value){setMarker(parseShadowRecoveryMarker(value));retained=true;}}catch{/* Never accept malformed recovery details. */}refreshMarker();setSummary(session.current?.summary()??null);setMessage(retained?'Setup stopped and the original recovery details are retained below. Save them before leaving this page; recovery still requires working browser storage.':acceptanceMode==='withhold-first-response'&&kind==='prepare'?'The first response was withheld or preparation stopped. Preserve the original record and use Recover original attempt.':'The action stopped. Preserve the original record; do not create another preparation.');}}
    finally{if(mounted.current)setBusy(false);}
  }
  function saveRecoveryDetails(){ensureHost();if(!marker)return;const url=URL.createObjectURL(new Blob([JSON.stringify(marker,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='shadow-original-recovery-details.json';link.click();URL.revokeObjectURL(url);}
  async function restoreRecoveryDetails(file:File|undefined){if(!file||busy)return;ensureHost();try{if(file.size>2048)throw Error('TOO_LARGE');const restored=parseShadowRecoveryMarker(JSON.parse(await file.text()));if(marker&&JSON.stringify(restored)!==JSON.stringify(marker))throw Error('ORIGINAL_RECORD_MISMATCH');setMarker(restored);setMessage('Original recovery details loaded. Recover will only reopen that exact saved journal.');}catch{setMessage('These recovery details do not match the original record. Nothing was changed.');}}
  function downloadResult(){ensureHost();const bytes=session.current?.readVerifiedResultBytes();if(!bytes)return;const blob=new Blob([new Uint8Array(bytes)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='shadow-verified-unsigned-result.json';link.click();URL.revokeObjectURL(url);}
  if(!allowed)return null;
  const prepareAllowed=shadowPreparationReady({flag,origin,walletAddress:walletKit?.identity?.address,reviewed,hasMarker:marker!==null,busy,readiness,now:Date.now()});
  return <main className="mx-auto h-full max-w-3xl overflow-y-auto p-6 text-sm" aria-labelledby="shadow-title">
    <h1 id="shadow-title" className="text-xl font-semibold">Shadow Testnet trial</h1>
    <p className="mt-3">Prepare one unsigned allowance revocation and recover the same request if its first response is lost. The returned transaction will not be executed.</p>
    <dl className="my-4 grid gap-2"><dt>Network</dt><dd>Arc Testnet · 5042002</dd><dt>Service cost</dt><dd>0.01 testUSDC maximum, including a failed preparation. Retrieval is free.</dd><dt>Required payer</dt><dd className="break-all">{SHADOW_PAYER}</dd><dt>Selected wallet</dt><dd className="break-all">{walletKit?.identity?.address??'No selected wallet'}</dd><dt>Merchant</dt><dd className="break-all">0xda65d415cc9d5ddc2a08bdffc996750755fc3cf0</dd><dt>Simulation sender</dt><dd className="break-all">{SHADOW_SENDER}</dd><dt>Unsigned call</dt><dd className="break-all">Token {SHADOW_TOKEN}: approve({SHADOW_SPENDER}, 0), transaction value 0.</dd><dt>Wallet permission</dt><dd>One typed-data authorization for this preparation. It lasts just over seven days.</dd></dl>
    <label className="block my-4">Recovery test <select aria-label="Recovery test" value={acceptanceMode} disabled={busy||marker!==null} onChange={event=>setAcceptanceMode(event.target.value as typeof acceptanceMode)} className="ml-2 border p-2"><option value="normal">Normal response</option><option value="withhold-first-response">Withhold the first response, then recover the same proof</option></select></label>
    <label className="block my-4"><input type="checkbox" checked={reviewed} disabled={busy||marker!==null} onChange={event=>setReviewed(event.target.checked)}/> I reviewed the existing 0.01 testUSDC trial, its payer and authorization duration.</label>
    <div className="flex flex-wrap gap-3"><button type="button" className="border px-3 py-2" disabled={busy||marker!==null} onClick={()=>void checkReadiness()}>Check public readiness</button><button type="button" className="border px-3 py-2" disabled={!prepareAllowed} onClick={()=>void operate('prepare')}>Prepare and review in wallet</button><button type="button" className="border px-3 py-2" disabled={busy||marker===null} onClick={()=>void operate('recover')}>Recover original attempt</button><button type="button" className="border px-3 py-2" disabled={busy||marker===null} onClick={()=>void operate('status')}>Check status</button><button type="button" className="border px-3 py-2" disabled={busy||summary?.phase!=='ready'} onClick={()=>void operate('retrieve')}>Retrieve free result</button><button type="button" className="border px-3 py-2" disabled={busy||!summary?.resultAvailable} onClick={downloadResult}>Save verified unsigned result</button></div>
    <p role="status" aria-live="polite" className="mt-5">{busy?'Waiting for the current step to finish.':message}</p>
    {marker&&<div className="mt-3"><p className="break-all">Original attempt: {marker.attemptId}. The same saved record will be used for recovery.</p><button type="button" className="mt-2 border px-3 py-2" disabled={busy} onClick={saveRecoveryDetails}>Save original recovery details</button></div>}
    {!marker&&<label className="mt-4 block">Restore original recovery details <input type="file" accept="application/json,.json" disabled={busy} onChange={event=>void restoreRecoveryDetails(event.target.files?.[0])}/></label>}
    <p className="mt-6">Aomi will inspect the signed preview, exact unsigned call and recovery result before sharing the result with Qdee.</p>
  </main>;
}
