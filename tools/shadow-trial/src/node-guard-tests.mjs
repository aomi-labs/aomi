import fs from 'node:fs';
import {runGuardTests} from './browser-guard-tests.mjs';
const databases=new Map();
async function memoryJournal({mode,fixtureDatabaseName,expectedJournalId}){
 let row=databases.get(fixtureDatabaseName);
 if(mode==='fixture-initialize'){if(row)throw Error('already exists');row={id:crypto.randomUUID(),state:null,reservation:null,proof:null,jobHash:null,count:0,locked:false};databases.set(fixtureDatabaseName,row);}
 else if(!row||row.id!==expectedJournalId)throw Error('missing identity');
 const locked=()=>{if(!row.locked)throw Error('lock required');};
 return{journalId:row.id,close(){},async withLock(fn){if(row.locked)throw Error('in use');row.locked=true;try{return await fn();}finally{row.locked=false;}},async load(){locked();return structuredClone(row.state);},async save(v){locked();row.state=structuredClone(v);},async reserveUnsigned(v){locked();if(row.reservation)throw Error('reservation exists');row.reservation=structuredClone(v);},async assertReservation(v){locked();if(JSON.stringify(row.reservation)!==JSON.stringify(v))throw Error('reservation mismatch');return{reserved:true,amountMicro:v.amountMicro,requestDigest:v.requestDigest};},async recordProofSubmission(v){locked();if(v.requestDigest!==row.reservation?.requestDigest||v.nonceHash!==row.reservation?.nonceHash||row.count>=2||(row.proof&&row.proof!==v.proofHash))throw Error('proof held');row.proof=v.proofHash;return{submissions:++row.count};},async recordJobIdentity(v){locked();if(row.proof!==v.proofHash||row.count<1||row.count>2||(row.jobHash&&row.jobHash!==v.jobIdentityHash))throw Error('job identity held');const matched=row.jobHash!==null;row.jobHash=v.jobIdentityHash;return{matched};},async assertJobIdentity(v){locked();if(row.proof!==v.proofHash||!row.jobHash||row.jobHash!==v.jobIdentityHash)throw Error('job identity held');return{matched:true};},async inspectSummary(){return{stateWritten:row.state!==null};}};
}
const result=await runGuardTests(memoryJournal);
result.completedAt=new Date().toISOString();result.runtime='Node WebCrypto, actual guarded client, in-memory journal; synthetic SDK, wallet, signature recovery and service. Real browser durability is separate.';
fs.writeFileSync(new URL('./node-guard-test-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(result.failed)process.exitCode=1;
