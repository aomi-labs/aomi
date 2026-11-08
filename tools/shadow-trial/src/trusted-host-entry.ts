// Explicit trusted-app entry. Importing this module does not open storage, fetch,
// connect a wallet, sign or purchase. The existing approved trial is required.
import { createGuardedShadowTrial } from './guarded-shadow-client.mjs';
import { openBrowserJournal } from './browser-journal.mjs';
import { createTaskPaymentRuntime } from './payment-runtime.browser';
import { recoverTypedDataAddress } from 'viem';

const PAYER = '0x12216f1365b9af24015baa158cc9e0d2354088a8';
const CHAIN = 5042002;
const MARKER_KEY = 'aomi-shadow-trial-recovery-marker-v1';
export type ShadowRecoveryMarker = Readonly<{ version: 1; journalId: string; attemptId: string; reviewReference: string }>;
export class ShadowHostSetupError extends Error {
  readonly recoveryMarker: ShadowRecoveryMarker;
  constructor(marker: ShadowRecoveryMarker) {
    super('SHADOW_HOST_CONFIGURATION_STOPPED_ORIGINAL_JOURNAL_RETAINED');
    this.name = 'ShadowHostSetupError'; this.recoveryMarker = Object.freeze({...marker});
  }
}
/** Reads nonsecret identity only. It never opens, replaces or resets a journal. */
export function readSavedShadowRecoveryMarker(): ShadowRecoveryMarker | null {
  const raw = localStorage.getItem(MARKER_KEY);
  if (raw === null) return null;
  requireThat(raw.length <= 2048, 'SHADOW_HOST_SAVED_MARKER_INVALID');
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error('SHADOW_HOST_SAVED_MARKER_INVALID'); }
  requireThat(value && Object.keys(value).sort().join(',') === 'attemptId,journalId,reviewReference,version' && value.version === 1 && typeof value.journalId === 'string' && value.journalId.length > 0 && value.journalId.length <= 128 && /^[A-Za-z0-9_.:-]{1,96}$/.test(value.attemptId ?? '') && typeof value.reviewReference === 'string' && value.reviewReference.length > 0 && value.reviewReference.length <= 256, 'SHADOW_HOST_SAVED_MARKER_INVALID');
  return Object.freeze({...value});
}
function sameMarker(a: ShadowRecoveryMarker | null, b: ShadowRecoveryMarker) {
  return a?.journalId === b.journalId && a.attemptId === b.attemptId && a.reviewReference === b.reviewReference;
}
function retainMarker(marker: ShadowRecoveryMarker) {
  const existing = readSavedShadowRecoveryMarker();
  requireThat(existing === null || sameMarker(existing, marker), 'SHADOW_HOST_SAVED_MARKER_MISMATCH');
  if (existing === null) localStorage.setItem(MARKER_KEY, JSON.stringify(marker));
  requireThat(sameMarker(readSavedShadowRecoveryMarker(), marker), 'SHADOW_HOST_MARKER_WRITE_UNCONFIRMED');
}
type WalletKit = { identity?: { address?: string }; signTypedData?: (payload: any) => Promise<{ signature: string }> };
type TrialAuthorization = {
  purchaseApproved: true; chainId: 5042002; payer: string;
  maxPreparationFeeMicrousd: '10000'; maxRetrievalFeeMicrousd: '0'; maxTotalFeeMicrousd: '10000';
  returnedTransactionExecution: false; reviewReference: string;
};
export type ShadowHostOptions = {
  mode: 'initialize' | 'reopen'; expectedJournalId?: string;
  acceptanceMode?: 'normal' | 'withhold-first-response';
  attemptId: string; reviewReference: string; authorization?: TrialAuthorization | null;
  walletKit?: WalletKit; trustedJwks: { keys: Record<string, unknown>[] };
  fetch: typeof fetch;
};
function requireThat(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

/** Call from an explicit host action. Reopen requires the original journal marker
 * and attempt ID. It cannot prepare a new payment or replace missing storage.
 * No user token, payment proof or raw provider error is returned in UI summaries.
 */
export async function openTrustedShadowSession(options: ShadowHostOptions) {
  requireThat(options && (options.mode === 'initialize' || options.mode === 'reopen'), 'SHADOW_HOST_EXPLICIT_MODE_REQUIRED');
  const { mode, expectedJournalId, authorization: auth, reviewReference, attemptId, walletKit } = options;
  const acceptanceMode = options.acceptanceMode ?? 'normal';
  requireThat(acceptanceMode === 'normal' || acceptanceMode === 'withhold-first-response', 'SHADOW_HOST_ACCEPTANCE_MODE_INVALID');
  requireThat(typeof reviewReference === 'string' && reviewReference.length > 0 && reviewReference.length <= 256 && /^[A-Za-z0-9_.:-]{1,96}$/.test(attemptId ?? ''), 'SHADOW_HOST_REVIEW_REQUIRED');
  requireThat(auth?.purchaseApproved === true && auth.chainId === CHAIN && auth.payer?.toLowerCase() === PAYER && auth.maxPreparationFeeMicrousd === '10000' && auth.maxRetrievalFeeMicrousd === '0' && auth.maxTotalFeeMicrousd === '10000' && auth.returnedTransactionExecution === false && auth.reviewReference === reviewReference, 'SHADOW_HOST_EXISTING_TRIAL_AUTHORIZATION_REQUIRED');
  requireThat(typeof options.fetch === 'function', 'SHADOW_HOST_EXPLICIT_FETCH_REQUIRED');
  if (mode === 'reopen') requireThat(typeof expectedJournalId === 'string' && expectedJournalId.length > 0, 'SHADOW_HOST_ORIGINAL_MARKER_REQUIRED');
  else {
    requireThat(expectedJournalId === undefined, 'SHADOW_HOST_INITIALIZE_CANNOT_REPLACE_MARKER');
    requireThat(walletKit?.identity?.address?.toLowerCase() === PAYER && typeof walletKit.signTypedData === 'function', 'SHADOW_HOST_SELECTED_WALLET_MISMATCH');
  }
  const savedMarker = readSavedShadowRecoveryMarker();
  if (mode === 'initialize') requireThat(savedMarker === null, 'SHADOW_HOST_ORIGINAL_MARKER_ALREADY_EXISTS');
  else if (savedMarker) requireThat(sameMarker(savedMarker, {version:1, journalId:expectedJournalId!, attemptId, reviewReference}), 'SHADOW_HOST_SAVED_MARKER_MISMATCH');
  const trustedJwks = structuredClone(options.trustedJwks);
  const keys = trustedJwks?.keys;
  requireThat(Array.isArray(keys) && keys.length > 0 && keys.every(key => key && key.kty === 'OKP' && key.crv === 'Ed25519' && typeof key.kid === 'string' && !Object.hasOwn(key, 'd') && (!key.alg || key.alg === 'EdDSA') && (!key.use || key.use === 'sig')) && new Set(keys.map(key => key.kid)).size === keys.length, 'SHADOW_HOST_TRUSTED_PUBLIC_KEYS_REQUIRED');
  try { for (const key of keys) await crypto.subtle.importKey('jwk', key, {name:'Ed25519'}, false, ['verify']); }
  catch { throw new Error('SHADOW_HOST_TRUSTED_PUBLIC_KEYS_INVALID'); }
  const payments = createTaskPaymentRuntime();
  const journal = await openBrowserJournal({ mode, expectedJournalId });
  const marker: ShadowRecoveryMarker = Object.freeze({version:1, journalId:journal.journalId, attemptId, reviewReference});
  let trial: any;
  try {
    retainMarker(marker);
    trial = await createGuardedShadowTrial({ journal, payments, walletKit,
      recoverTypedDataAddress, fetch: options.fetch, trustedJwks,
      attemptId, reviewReference, authorization: structuredClone(auth), controlledResponseLoss: acceptanceMode === 'withhold-first-response' });
  } catch {
    journal.close();
    throw new ShadowHostSetupError(marker);
  }
  let closed = false, busy = false, prepared = false, storageClosed = false;
  let phase = mode === 'reopen' ? 'reopen_required' : 'ready_for_review';
  let lastOperation: string | null = null, resultBytes: Uint8Array | null = null;
  function summary() {
    return Object.freeze({ journalId: journal.journalId, attemptId, mode, acceptanceMode, payer: PAYER, chainId: CHAIN,
      preparationFeeMicro: '10000', retrievalFeeMicro: '0', maximumTotalFeeMicro: '10000',
      returnedTransactionExecution: false, closed, busy, phase, lastOperation, resultAvailable: resultBytes !== null });
  }
  function closeStorageIfIdle() {
    if (closed && !busy && !storageClosed) { journal.close(); storageClosed = true; }
  }
  async function run(kind: 'prepare' | 'recover' | 'status' | 'retrieve') {
    requireThat(!closed && !busy, 'SHADOW_HOST_CLOSED_OR_BUSY');
    requireThat(sameMarker(readSavedShadowRecoveryMarker(), marker), 'SHADOW_HOST_ORIGINAL_MARKER_REQUIRED');
    if (kind === 'prepare') {
      requireThat(mode === 'initialize' && !prepared, 'SHADOW_HOST_PREPARE_NOT_REPEATABLE_USE_ORIGINAL_RECOVERY');
      prepared = true;
    }
    busy = true; lastOperation = kind;
    try {
      const result = await trial[kind]();
      requireThat(!closed, 'SHADOW_HOST_CLOSED');
      requireThat(['payment_pending','preparing','ready','failed','expired','complete'].includes(result?.status), 'SHADOW_HOST_UNEXPECTED_RESULT');
      phase = result.status;
      if (result.status === 'complete') {
        requireThat(result.bytes instanceof Uint8Array, 'SHADOW_HOST_INVALID_RESULT_BYTES');
        resultBytes = result.bytes.slice();
      }
    } catch {
      if (!closed) phase = 'reconciliation_required';
      throw new Error('SHADOW_HOST_OPERATION_STOPPED_RETAIN_ORIGINAL_JOURNAL');
    } finally { busy = false; closeStorageIfIdle(); }
    return summary();
  }
  return Object.freeze({ summary,
    prepare: () => run('prepare'), recover: () => run('recover'), status: () => run('status'), retrieve: () => run('retrieve'),
    readVerifiedResultBytes() {
      requireThat(!closed && resultBytes !== null, 'SHADOW_HOST_NO_VERIFIED_RESULT');
      return resultBytes.slice();
    },
    close() {
      if (!closed) { closed = true; phase = 'closed'; resultBytes = null; trial.close(); }
      closeStorageIfIdle();
    },
  });
}
