import {SHADOW_PAYER,SHADOW_SENDER,SHADOW_TOKEN,SHADOW_SPENDER,SHADOW_PUBLIC_JWKS,type ShadowReadiness} from './shadow-trial-policy';
const RPC='https://rpc.testnet.arc.network';
const assert=(value:unknown,code:string)=>{if(!value)throw Error(code);};
const stable=(value:any):string=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
/** Explicit public read-only preflight. No wallet/session, retries, alternate
 * provider, payable challenge, approval, deposit or transaction submission. */
export async function readShadowReadiness(hostFetch:typeof fetch,clock:()=>number=Date.now):Promise<ShadowReadiness>{
  const startedAt=clock();
  async function json(url:string,body?:unknown){
    const response=await hostFetch(url,{method:body===undefined?'GET':'POST',headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
    assert(response.ok,'SHADOW_READINESS_PUBLIC_READ_UNAVAILABLE');
    const reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
    if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw Error('SHADOW_READINESS_RESPONSE_TOO_LARGE');}text+=decoder.decode(part.value,{stream:true});}
    text+=decoder.decode();return JSON.parse(text);
  }
  let id=0;
  async function rpc(method:string,params:unknown[]){const expected=++id;const response=await json(RPC,{jsonrpc:'2.0',id:expected,method,params});assert(response.jsonrpc==='2.0'&&response.id===expected&&!response.error&&Object.hasOwn(response,'result'),'SHADOW_READINESS_RPC_RESULT_INVALID');return response.result;}
  assert(await rpc('eth_chainId',[])==='0x4cef52','SHADOW_READINESS_WRONG_CHAIN');
  const block=await rpc('eth_blockNumber',[]);assert(/^0x[0-9a-f]+$/i.test(block),'SHADOW_READINESS_BLOCK_INVALID');
  assert(await rpc('eth_getCode',[SHADOW_SENDER,block])==='0x','SHADOW_READINESS_SENDER_NOT_EOA');
  const call='0xdd62ed3e'+SHADOW_SENDER.slice(2).padStart(64,'0')+SHADOW_SPENDER.slice(2).padStart(64,'0');
  const allowance=await rpc('eth_call',[{to:SHADOW_TOKEN,data:call},block]);assert(/^0x[0-9a-f]{64}$/i.test(allowance)&&BigInt(allowance)>0n,'SHADOW_READINESS_ALLOWANCE_NOT_POSITIVE');
  // Official Circle3.5 GatewayClient.getGatewayBalance: public balances read.
  const gateway=await json('https://gateway-api-testnet.circle.com/v1/balances',{token:'USDC',sources:[{depositor:SHADOW_PAYER,domain:26}]});
  assert(Array.isArray(gateway.balances)&&gateway.balances.length===1,'SHADOW_READINESS_GATEWAY_RESULT_INVALID');
  const row=gateway.balances[0];
  const echoedDepositor=row.depositor;
  const depositorMatches=echoedDepositor===undefined||(typeof echoedDepositor==='string'&&(echoedDepositor.toLowerCase()===SHADOW_PAYER||echoedDepositor.toLowerCase()==='0x'+SHADOW_PAYER.slice(2).padStart(64,'0')));
  assert(row.domain===26&&depositorMatches&&typeof row.balance==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(row.balance),'SHADOW_READINESS_GATEWAY_RESULT_INVALID');
  const [whole,fraction='']=row.balance.split('.');const available=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
  assert(available>=10000n,'SHADOW_READINESS_GATEWAY_BALANCE_LOW');
  const jwks=await json('https://api-staging.aomi.dev/.well-known/jwks.json');
  assert(stable(jwks)===stable(SHADOW_PUBLIC_JWKS),'SHADOW_READINESS_TRUSTED_KEY_CHANGED');
  return Object.freeze({checkedAt:startedAt,block,allowanceAtomic:BigInt(allowance).toString(),gatewayAvailableMicro:available.toString(),publicKeyMatched:true});
}
