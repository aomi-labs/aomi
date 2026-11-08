export type ShadowRecoveryMarker = Readonly<{version:1;journalId:string;attemptId:string;reviewReference:string}>;
export declare class ShadowHostSetupError extends Error {readonly recoveryMarker:ShadowRecoveryMarker;constructor(marker:ShadowRecoveryMarker);}
export type ShadowHostOptions = {
 mode:'initialize'|'reopen';acceptanceMode?:'normal'|'withhold-first-response';expectedJournalId?:string;attemptId:string;reviewReference:string;
 authorization?:{purchaseApproved:true;chainId:5042002;payer:string;maxPreparationFeeMicrousd:'10000';maxRetrievalFeeMicrousd:'0';maxTotalFeeMicrousd:'10000';returnedTransactionExecution:false;reviewReference:string}|null;
 walletKit?:{identity?:{address?:string};signTypedData?:(payload:any)=>Promise<{signature:string}>};
 trustedJwks:{keys:Record<string,unknown>[]};fetch:typeof fetch;
};
export type ShadowHostSummary = Readonly<{journalId:string;attemptId:string;mode:'initialize'|'reopen';acceptanceMode:'normal'|'withhold-first-response';payer:string;chainId:5042002;preparationFeeMicro:'10000';retrievalFeeMicro:'0';maximumTotalFeeMicro:'10000';returnedTransactionExecution:false;closed:boolean;busy:boolean;phase:string;lastOperation:string|null;resultAvailable:boolean}>;
export interface ShadowHostSession {
 summary():ShadowHostSummary;prepare():Promise<ShadowHostSummary>;recover():Promise<ShadowHostSummary>;status():Promise<ShadowHostSummary>;retrieve():Promise<ShadowHostSummary>;readVerifiedResultBytes():Uint8Array;close():void;
}
export declare function readSavedShadowRecoveryMarker():ShadowRecoveryMarker|null;
export declare function openTrustedShadowSession(options:ShadowHostOptions):Promise<ShadowHostSession>;
