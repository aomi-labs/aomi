export const SHADOW_ORIGIN = 'https://chat-staging.aomi.dev';
export const SHADOW_PAYER = '0x12216f1365b9af24015baa158cc9e0d2354088a8';
export const SHADOW_SENDER = '0x759674c35a9f34b81f420f17bd2afea04fafd0e9';
export const SHADOW_TOKEN = '0x3600000000000000000000000000000000000000';
export const SHADOW_SPENDER = '0x73742278c31a76dbb0d2587d03ef92e6e2141023';
export const SHADOW_REVIEW = 'shadow-approved-testnet-revocation-2026-11-08';
export const SHADOW_PUBLIC_JWKS = {keys:[{kty:'OKP',crv:'Ed25519',use:'sig',key_ops:['verify'],alg:'EdDSA',kid:'aomi-api-server-staging-1',x:'SSoS5R7oDRof_8pDVwtHUeR9ibmkZDwMYBojA6NYIPQ'}]};
export function shadowHostEnabled(flag: unknown, origin: string | null) { return flag === 'true' && origin === SHADOW_ORIGIN; }
export function shadowExistingTrialAuthorization(reviewReference = SHADOW_REVIEW) {
  return {purchaseApproved:true as const,chainId:5042002 as const,payer:SHADOW_PAYER,maxPreparationFeeMicrousd:'10000' as const,maxRetrievalFeeMicrousd:'0' as const,maxTotalFeeMicrousd:'10000' as const,returnedTransactionExecution:false as const,reviewReference};
}
export type ShadowReadiness = Readonly<{checkedAt:number;block:string;allowanceAtomic:string;gatewayAvailableMicro:string;publicKeyMatched:true}>;
export function shadowPreparationReady(input:{flag:unknown;origin:string|null;walletAddress?:string;reviewed:boolean;hasMarker:boolean;busy:boolean;readiness:ShadowReadiness|null;now:number}) {
  return shadowHostEnabled(input.flag,input.origin)&&input.walletAddress?.toLowerCase()===SHADOW_PAYER&&input.reviewed&&!input.hasMarker&&!input.busy&&input.readiness!==null&&input.now>=input.readiness.checkedAt&&input.now-input.readiness.checkedAt<=120000&&BigInt(input.readiness.allowanceAtomic)>0n&&BigInt(input.readiness.gatewayAvailableMicro)>=10000n;
}

export type ShadowMarker = Readonly<{version:1;journalId:string;attemptId:string;reviewReference:string}>;
export function parseShadowRecoveryMarker(value:unknown):ShadowMarker {
  const v=value as Record<string,unknown>;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='attemptId,journalId,reviewReference,version'||v.version!==1||typeof v.journalId!=='string'||v.journalId.length<1||v.journalId.length>128||typeof v.attemptId!=='string'||!/^[A-Za-z0-9_.:-]{1,96}$/.test(v.attemptId)||typeof v.reviewReference!=='string'||v.reviewReference.length<1||v.reviewReference.length>256)throw Error('SHADOW_RECOVERY_DETAILS_INVALID');
  return Object.freeze({version:1,journalId:v.journalId,attemptId:v.attemptId,reviewReference:v.reviewReference});
}
