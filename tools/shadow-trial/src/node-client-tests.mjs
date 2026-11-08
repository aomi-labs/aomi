import fs from 'node:fs';
import {runClientTests} from './browser-client-tests.mjs';
const databases=new Map();
async function memoryJournal({mode,fixtureDatabaseName,expectedJournalId}){
 let row=databases.get(fixtureDatabaseName);
 if(mode==='fixture-initialize'){if(row)throw Error('already exists');row={id:crypto.randomUUID(),state:null,locked:false};databases.set(fixtureDatabaseName,row);}
 else if(!row||row.id!==expectedJournalId)throw Error('missing identity');
 return{journalId:row.id,close(){},async withLock(fn){if(row.locked)throw Error('in use');row.locked=true;try{return await fn();}finally{row.locked=false;}},async load(){return structuredClone(row.state);},async save(v){row.state=structuredClone(v);},async inspectSummary(){return{stateWritten:row.state!==null};}};
}
const result=await runClientTests(memoryJournal);
result.completedAt=new Date().toISOString();
result.runtime='Node WebCrypto and actual adapted client; in-memory test journal, synthetic payment/wallet/service. Browser persistence is separate.';
fs.writeFileSync(new URL('./node-client-test-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(result.failed)process.exitCode=1;
