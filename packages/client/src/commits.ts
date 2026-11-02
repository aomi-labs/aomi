import type { AomiClient } from "./client";
import { normalizeEvmWalletTarget } from "./wallet/target";
import type { EvmWallet, Wallets } from "./wallet/types";
import type { components } from "./generated/agent-v1/types";
import type { ActionRequest } from "./agent/types";
import {
  PipelineSchemaError,
  validatePipelineArguments,
} from "./pipeline/schema";
import {
  actionRequestSchema,
  agentSchemas,
} from "./generated/agent-v1/schemas";
import { isMessageReview, reviewEligibility } from "./commit-lifecycle";
import {
  callsAccepted,
  errorChain,
  partialWalletExecution,
} from "./aa/execute";
import {
  COMMIT_REF_ERROR_CODES,
  CommitStaleError,
  commitRefError,
  commitRefPaths,
  type CommitRefView,
} from "./commit-ref";

export type CommitTransport = components["schemas"]["CommitTransport"];
type SignableOf<K extends SignableCommit["kind"]> = Extract<
  SignableCommit,
  { kind: K }
>;
/** The `request` of a `send_calls` attempt: every batch member's call. */
export type WalletCallsCommit = SignableOf<"wallet_calls">;
/** One member's call inside a `send_calls` bundle, in batch order. */
export type WalletCallsCommitCall = WalletCallsCommit["calls"][number];
/** The message a wallet signs; `digest` is what the signature covers. */
export type EvmMessageCommit = SignableOf<"evm_message">;
/** What a message signature covers: EIP-712 typed data, or ERC-191 bytes
 * (`0x` hex, or plain text signed as its UTF-8 bytes). */
export type EvmCommitMessage = EvmMessageCommit["message"];
/** One row of a message review. Amounts are raw integers. */
export type MessageReviewRow =
  | {
      kind: "allowance";
      token: string;
      spender: string;
      amount: string;
      unlimited: boolean;
      /** Unix seconds. */
      expires_at?: number;
    }
  | { kind: "sell"; token: string; amount: string }
  | { kind: "receive"; token: string; amount: string; minimum: boolean }
  | { kind: "sign_in"; domain: string; statement?: string }
  | { kind: "text"; text: string };
/** What a message signature allows, decoded by the backend. */
export type MessageReview = {
  kind: "permit" | "permit2" | "cow_order" | "sign_in" | "generic";
  rows: MessageReviewRow[];
  /** Token names for the rows, keyed by the rows' `token` string (EIP-55;
   * compare case-insensitively). */
  tokens?: Record<string, { symbol?: string; decimals?: number }>;
  /** Unix seconds. */
  expires_at?: number;
  warning?: string;
};
export type CommitView = components["schemas"]["CommitView"];
export type CommitState = CommitView["state"];
export type SignableCommit = components["schemas"]["SignableCommit"];
export type CommitAction = NonNullable<CommitView["action"]>;
export type CommitWalletAttemptRequest =
  components["schemas"]["CommitWalletAttemptRequest"];
export type CommitWalletAttemptView =
  components["schemas"]["CommitWalletAttemptView"];
export type CommitWalletAttemptOutcome =
  components["schemas"]["CommitWalletAttemptOutcome"];
export type CommitSubmissionPhase =
  | "preparing"
  | "switching_chain"
  | "awaiting_wallet"
  | "submitting";
/** What the chain's own receipt said about the sent transactions. Display
 * only: Commit Service settles the commit and its state replaces this. */
export type OnChainOutcome = "success" | "reverted";
const RECEIPT_WATCH_MS = 120_000;
export type EvmCommitTransaction = Extract<
  SignableCommit,
  { kind: "evm_transaction" }
>["transaction"];
type EvmSignableCommit = Extract<SignableCommit, { kind: "evm_transaction" }>;
/** A commit review in the Action vocabulary rendered by TransactionReview. */
export type CommitReview =
  | Exclude<ActionRequest, { type: "sign" }>
  | SignCommitReview;
type SignCommitReview = Extract<ActionRequest, { type: "sign" }> & {
  /** Set on a message commit's review (`executionKind: "evm_message"`). */
  messageReview?: MessageReview;
};
/** A message commit's review: a pipeline `sign` request plus its rows. */
export type MessageCommitReview = SignCommitReview & {
  executionKind: "evm_message";
};
export type CommitManual =
  /** `version` / `review_digest` bind a message signature to its review. */
  | {
      kind: "signed";
      payloads: string[];
      version?: number;
      review_digest?: string;
    }
  | { kind: "broadcast"; transaction_id: string }
  | { kind: "rejected" };
type WalletRejection = Extract<
  CommitWalletAttemptOutcome,
  { kind: "rejected" }
>;
type WalletSendPlan = {
  transport: "browser_send" | "send_calls";
  payload: EvmSignableCommit;
  reviewDigest: string;
};
export type CommitExecutionReview = {
  expectedVersion: number;
  expectedReviewDigest?: string;
};
export type CommitRecoveryRecord = {
  clientRequestId: string;
  attemptId?: string;
  /** EIP-5792 bundle identity, retained when status lookup fails. */
  callsId?: string;
  /** Original wallet failure, retained across reloads while outcome is unknown. */
  walletError?: string;
  callsNotSubmitted?: true;
  transactionId?: string;
  /** Hashes a `send_calls` bundle landed, saved before they are reported. */
  transactionIds?: string[];
  rejected?: true;
  rejection?: WalletRejection;
};
export type CommitRecoveryStore = {
  load: (
    threadId: string,
    commitId: string,
  ) => CommitRecoveryRecord | undefined;
  save: (
    threadId: string,
    commitId: string,
    record: CommitRecoveryRecord,
  ) => void;
  remove: (threadId: string, commitId: string) => void;
};
/** Wallet operations available to the durable Commit lifecycle. */
export type CommitCapabilities = {
  sign?: (commit: CommitView, payload: SignableCommit) => Promise<string[]>;
  canSign?: (commit: CommitView, payload: SignableCommit) => boolean;
  walletBroadcast?: (
    commit: CommitView,
    signedBytes: string,
  ) => Promise<string>;
  canWalletBroadcast?: (commit: CommitView) => boolean;
  venueBroadcast?: (commit: CommitView, signedBytes: string) => Promise<string>;
  walletSend?: (
    commit: CommitView,
    payload: Extract<SignableCommit, { kind: "evm_transaction" }>,
    onPhase?: (phase: Exclude<CommitSubmissionPhase, "preparing">) => void,
  ) => Promise<string>;
  walletSendPreflight?: (
    commit: CommitView,
    payload: Extract<SignableCommit, { kind: "evm_transaction" }>,
  ) => Promise<void>;
  canWalletSend?: (
    commit: CommitView,
    payload: Extract<SignableCommit, { kind: "evm_transaction" }>,
  ) => boolean;
  /** Send a whole batch as one EIP-5792 bundle; answers every landed hash. */
  walletSendCalls?: (
    commit: CommitView,
    request: WalletCallsCommit,
    onPhase?: (phase: Exclude<CommitSubmissionPhase, "preparing">) => void,
    onAccepted?: (callsId: string) => void,
  ) => Promise<string[]>;
  /** Read an accepted bundle without invoking another send. */
  walletCallsStatus?: (
    commit: CommitView,
    callsId: string,
  ) => Promise<
    | Extract<
        CommitWalletAttemptOutcome,
        { kind: "calls" | "calls_not_submitted" }
      >
    | undefined
  >;
  /** The connected wallet is the signer and may be asked to bundle on the
   * commit's chain: it is not known to lack batching there. */
  canWalletSendCalls?: (commit: CommitView) => boolean;
  /** The chain's receipt for the hashes the wallet just returned. Resolves
   * once the receipt is mined; display only, never reported to the backend. */
  walletReceipt?: (
    commit: CommitView,
    transactionIds: string[],
  ) => Promise<OnChainOutcome>;
  recovery?: CommitRecoveryStore;
};
const COMMIT_CAPABILITY_KEYS = [
  "sign",
  "canSign",
  "walletBroadcast",
  "canWalletBroadcast",
  "venueBroadcast",
  "walletSend",
  "walletSendPreflight",
  "canWalletSend",
  "walletSendCalls",
  "walletCallsStatus",
  "canWalletSendCalls",
  "recovery",
] as const satisfies readonly (keyof CommitCapabilities)[];
export const isTerminalCommit = (view: CommitView): boolean =>
  ["confirmed", "rejected", "failed", "expired"].includes(view.state);
/** How one group goes out. A group is one batch (one wallet, one chain) or a
 * lone commit; execution, labels, progress and the review queue all read it. */
export type GroupPlan = {
  /** `agent`: Aomi signs after approval, so the browser prompts nothing. */
  transport: CommitTransport | "agent";
  /** Wallet prompts for the whole group. */
  prompts: number;
  /** Every member lands together. */
  atomic: boolean;
};
/** The plan for the group `leader` leads: the transport its attempt took,
 * else the one this wallet would take among those the backend allows. A
 * bundle the wallet is known to refuse falls back to one prompt per member.
 * Aomi runs an agent group as one operation when the backend marks it
 * `atomic`, else as one transaction per member. */
function groupPlan(
  leader: CommitView,
  capabilities: CommitCapabilities,
): GroupPlan {
  const size = leader.batch?.ordered_commit_ids.length ?? 1;
  if (leader.approval || leader.signing_mode === "auto")
    return {
      transport: "agent",
      prompts: 0,
      atomic: size === 1 || leader.atomic === true,
    };
  const offered = leader.supported_transports ?? [];
  const bundles = Boolean(
    capabilities.walletSendCalls &&
    capabilities.recovery &&
    capabilities.canWalletSendCalls?.(leader),
  );
  const transport =
    leader.wallet_attempt?.transport ??
    (bundles && offered.includes("send_calls")
      ? "send_calls"
      : capabilities.walletSend &&
          capabilities.walletSendPreflight &&
          capabilities.recovery &&
          (offered.includes("browser_send") ||
            leader.action?.kind === "start_wallet_send")
        ? "browser_send"
        : "sign_and_broadcast");
  return transport === "send_calls" && bundles
    ? { transport, prompts: 1, atomic: true }
    : { transport, prompts: size, atomic: size === 1 };
}

const continuationRevision = (view: CommitView): number =>
  view.continuation?.revision ?? -1;
/** Chain state and assistant delivery advance on independent monotonic
 * counters, so each axis keeps its newer side. At an equal chain version only
 * an authoritative response replaces the cached view; stamped continuation
 * metadata is immutable at its revision. */
function mergeCommitView(
  current: CommitView,
  incoming: CommitView,
  authoritative: boolean,
): CommitView {
  const base = (
    authoritative
      ? incoming.version >= current.version
      : incoming.version > current.version
  )
    ? incoming
    : current;
  const continuation =
    continuationRevision(incoming) > continuationRevision(current)
      ? incoming.continuation
      : current.continuation;
  return base.continuation === continuation ? base : { ...base, continuation };
}
const needsCommitRefresh = (view: CommitView): boolean =>
  !isTerminalCommit(view) ||
  view.continuation?.state === "pending" ||
  view.continuation?.state === "retrying";

function commitReview(value: unknown): CommitReview | undefined {
  try {
    assertActionRequest(value);
  } catch (error) {
    if (error instanceof PipelineSchemaError) return undefined;
    throw error;
  }
  return value.type === "execute_evm" ||
    value.type === "execute_svm" ||
    isMessageReview(value)
    ? value
    : undefined;
}

function assertActionRequest(value: unknown): asserts value is ActionRequest {
  validatePipelineArguments(value, actionRequestSchema, agentSchemas);
}

/** Compatibility presentation for commits admitted before typed SVM reviews
 * were persisted. Remove after every readable SVM commit carries review data. */
function legacySvmReview(
  view: CommitView | undefined,
): CommitReview | undefined {
  if (view?.chain_family !== "svm" || view.review) return undefined;
  const action = view.action;
  const broadcasting = action?.kind === "broadcast";
  const payloads =
    action?.kind === "sign" && action.payload.kind === "svm_transaction"
      ? [
          {
            kind: "svm_transaction" as const,
            transaction_base64: action.payload.transaction_base64,
          },
        ]
      : broadcasting
        ? []
        : undefined;
  if (!payloads) return undefined;
  return {
    type: "sign",
    requestId: view.commit_id,
    chainFamily: "svm",
    executionKind: "transaction",
    signer: view.signer,
    cluster: view.chain_ref,
    description: broadcasting
      ? "Submit signed Solana transaction"
      : "Review Solana transaction",
    payloads,
    broadcaster: view.broadcaster,
  };
}

/** Commit Service accepts rejection diagnostics as a complete set or none. */
function walletRejection(phase?: WalletRejection["phase"]): WalletRejection {
  return phase
    ? {
        kind: "rejected",
        phase,
        provider_code: "4001",
        reason_category: "user_rejected",
      }
    : { kind: "rejected" };
}
/** Replays a saved outcome, healing records saved with partial diagnostics. */
function recordedOutcome(
  record: CommitRecoveryRecord,
): CommitWalletAttemptOutcome {
  if (record.callsNotSubmitted && record.callsId)
    return { kind: "calls_not_submitted", calls_id: record.callsId };
  if (record.transactionIds?.length)
    return { kind: "calls", transaction_ids: record.transactionIds };
  return record.transactionId
    ? { kind: "transaction", transaction_id: record.transactionId }
    : walletRejection(record.rejection?.phase);
}
const hasRecordedOutcome = (record: CommitRecoveryRecord): boolean =>
  Boolean(
    record.transactionId ||
    record.transactionIds?.length ||
    record.rejected ||
    (record.callsNotSubmitted && record.callsId),
  );
/** A 4xx answer proves the attempt was not admitted; 408 stays ambiguous. */
function isDefiniteRequestFailure(error: unknown): boolean {
  const status = /^HTTP (4\d\d)\b/.exec(
    error instanceof Error ? error.message : "",
  )?.[1];
  return status !== undefined && status !== "408";
}

/** Only bounded human diagnostics, never a serialized provider response. */
function walletFailureMessage(error: unknown): string {
  if (typeof error === "string") return error.split("\n", 1)[0].slice(0, 256);
  const messages = errorChain(error)
    .slice(0, 4)
    .flatMap((link) => {
      const record = link as Record<string, unknown>;
      const message = [
        record.shortMessage,
        record.message,
        record.details,
      ].find((value): value is string => typeof value === "string");
      const code =
        typeof record.code === "string" || typeof record.code === "number"
          ? ` (code ${String(record.code).slice(0, 40)})`
          : "";
      return message
        ? [
            message
              .split(/\n|URL:|Request body:|Request Arguments:/, 1)[0]
              .slice(0, 256) + code,
          ]
        : code
          ? [code.trim()]
          : [];
    });
  return (
    [...new Set(messages)].join(": ").slice(0, 700) ||
    "Wallet request failed; its outcome is unknown"
  );
}

/** A 4001 before the wallet accepted anything: once it answered a call id,
 * the calls may land whatever it says after, so the outcome is reconciled. */
function isExplicitWalletRejection(error: unknown): boolean {
  return (
    !callsAccepted(error) &&
    errorChain(error).some(({ code }) => code === 4001 || code === "4001")
  );
}

function payloadMatchesCommit(
  commit: CommitView,
  payload: SignableCommit | WalletCallsCommit,
): boolean {
  if (payload.kind === "svm_transaction" || payload.kind === "svm_message")
    return commit.chain_family === "svm" && payload.signer === commit.signer;
  return (
    commit.chain_family === "evm" &&
    payload.signer.toLowerCase() === commit.signer.toLowerCase() &&
    payload.chain_id === Number(commit.chain_ref)
  );
}

/** A message signature names the review it covers on every route, as ref
 * writes always do. */
function signedWrite(view: CommitView, payloads: string[]): CommitManual {
  return view.action?.kind === "sign" &&
    view.action.payload.kind === "evm_message"
    ? {
        kind: "signed",
        payloads,
        version: view.version,
        ...(view.review ? { review_digest: view.review.digest } : {}),
      }
    : { kind: "signed", payloads };
}

/**
 * Signs a message commit with the wallet's prepared-message signer, else its
 * plain typed-data or personal signer: those take the typed data whole and
 * read `0x` hex as its bytes, text as UTF-8, exactly as a prepared one does.
 */
function messageSigner(
  evm: EvmWallet | undefined,
  payload: EvmMessageCommit,
): (() => Promise<string>) | undefined {
  const { signPreparedMessage, signTypedData, signMessage } = evm ?? {};
  if (signPreparedMessage) return () => signPreparedMessage(payload);
  const { message, chain_id: chainId } = payload;
  const sign =
    message.format === "typed_data"
      ? signTypedData &&
        (() => signTypedData({ typedData: message.typed_data, chainId }))
      : signMessage &&
        (() => signMessage({ message: message.message, chainId }));
  return (
    sign &&
    (async () => {
      const signed = await sign();
      return typeof signed === "string" ? signed : signed.signature;
    })
  );
}

export function commitCapabilities(
  wallets: Wallets,
  recovery?: CommitRecoveryStore,
): CommitCapabilities {
  const evm = wallets.evm;
  const sendPrepared = evm?.sendPreparedTransaction;
  const preparePrepared = evm?.preparePreparedTransaction;
  const sendPreparedCalls = evm?.sendPreparedCalls;
  const supportsAtomicBatch = evm?.supportsAtomicBatch;
  const canSign = (commit: CommitView, payload: SignableCommit): boolean => {
    if (!payloadMatchesCommit(commit, payload)) return false;
    if (payload.kind === "svm_transaction")
      return Boolean(
        wallets.svm?.signTransaction &&
        commit.chain_family === "svm" &&
        wallets.svm.address === commit.signer,
      );
    return Boolean(
      commit.chain_family === "evm" &&
      evm?.address.toLowerCase() === commit.signer.toLowerCase() &&
      (payload.kind === "evm_transaction"
        ? evm?.signTransaction
        : payload.kind === "evm_message"
          ? messageSigner(evm, payload)
          : evm?.signMessage),
    );
  };
  const canWalletBroadcast = (commit: CommitView): boolean =>
    commit.chain_family === "evm"
      ? Boolean(evm?.broadcastTransaction)
      : Boolean(wallets.svm?.broadcastTransaction);
  return {
    recovery,
    canSign,
    canWalletBroadcast,
    ...(evm && sendPrepared && preparePrepared
      ? {
          canWalletSend(commit, payload) {
            return (
              payloadMatchesCommit(commit, payload) &&
              evm.address.toLowerCase() === commit.signer.toLowerCase()
            );
          },
          async walletSendPreflight(commit, payload) {
            if (!payloadMatchesCommit(commit, payload))
              throw new Error(
                "Prepared commit payload does not match its signer or chain",
              );
            if (evm.address.toLowerCase() !== commit.signer.toLowerCase())
              throw new Error("Connect the expected signing wallet");
            normalizeEvmWalletTarget(payload.transaction.to);
            await preparePrepared(payload);
          },
          async walletSend(commit, payload, onPhase) {
            if (!payloadMatchesCommit(commit, payload))
              throw new Error(
                "Prepared commit payload does not match its signer or chain",
              );
            if (evm.address.toLowerCase() !== commit.signer.toLowerCase())
              throw new Error("Connect the expected signing wallet");
            const walletPayload = {
              ...payload,
              transaction: {
                ...payload.transaction,
                to: normalizeEvmWalletTarget(payload.transaction.to),
              },
            };
            return onPhase
              ? sendPrepared(walletPayload, onPhase)
              : sendPrepared(walletPayload);
          },
        }
      : {}),
    ...(evm && sendPreparedCalls && supportsAtomicBatch
      ? {
          canWalletSendCalls(commit) {
            return (
              commit.chain_family === "evm" &&
              evm.address.toLowerCase() === commit.signer.toLowerCase() &&
              supportsAtomicBatch(Number(commit.chain_ref))
            );
          },
          async walletSendCalls(commit, request, onPhase, onAccepted) {
            if (
              !payloadMatchesCommit(commit, request) ||
              evm.address.toLowerCase() !== commit.signer.toLowerCase()
            )
              throw new Error("Connect the expected signing wallet");
            const walletRequest = {
              ...request,
              calls: request.calls.map((call) => ({
                ...call,
                to: normalizeEvmWalletTarget(call.to),
              })),
            };
            return onPhase || onAccepted
              ? sendPreparedCalls(walletRequest, onPhase, onAccepted)
              : sendPreparedCalls(walletRequest);
          },
        }
      : {}),
    ...(evm?.getPreparedCallsStatus
      ? ({
          async walletCallsStatus(commit, callsId) {
            if (evm.address.toLowerCase() !== commit.signer.toLowerCase())
              throw new Error("Connect the expected signing wallet");
            return evm.getPreparedCallsStatus!({
              callsId,
              chainId: Number(commit.chain_ref),
              signer: commit.signer,
            });
          },
        } satisfies Pick<CommitCapabilities, "walletCallsStatus">)
      : {}),
    ...(evm?.waitForReceipt
      ? {
          async walletReceipt(commit, transactionIds) {
            const chainId = Number(commit.chain_ref);
            const receipts = await Promise.all(
              transactionIds.map((hash) =>
                evm.waitForReceipt!({ chainId, hash }),
              ),
            );
            if (receipts.some((receipt) => receipt.status === "reverted"))
              return "reverted";
            if (receipts.every((receipt) => receipt.status === "success"))
              return "success";
            throw new Error("Receipt status unknown");
          },
        }
      : {}),
    async sign(commit, payload) {
      if (!payloadMatchesCommit(commit, payload))
        throw new Error(
          "Prepared commit payload does not match its signer or chain",
        );
      const wallet = commit.chain_family === "evm" ? wallets.evm : wallets.svm;
      if (
        !wallet ||
        (commit.chain_family === "evm"
          ? wallet.address.toLowerCase() !== commit.signer.toLowerCase()
          : wallet.address !== commit.signer)
      )
        throw new Error("Connect the expected signing wallet");
      switch (payload.kind) {
        case "evm_transaction": {
          if (!wallets.evm?.signTransaction)
            throw new Error(
              "Wallet does not support sign-only EVM transactions",
            );
          await wallets.evm.switchChain?.(payload.chain_id);
          return [await wallets.evm.signTransaction(payload)];
        }
        case "evm_message": {
          const sign = messageSigner(wallets.evm, payload);
          if (!sign) throw new Error("Wallet does not support message commits");
          if (
            wallets.evm!.address.toLowerCase() !== payload.signer.toLowerCase()
          )
            throw new Error("Connect the expected signing wallet");
          // Wallets bind typed data to their active chain (`domain.chainId`).
          if (payload.message.format === "typed_data")
            await wallets.evm!.switchChain?.(payload.chain_id);
          return [await sign()];
        }
        case "svm_transaction": {
          if (!wallets.svm?.signTransaction)
            throw new Error(
              "Wallet does not support sign-only SVM transactions",
            );
          await wallets.svm.switchCluster?.(commit.chain_ref);
          const signed = await wallets.svm.signTransaction({
            transactionBase64: payload.transaction_base64,
            cluster: commit.chain_ref,
          });
          const bytes =
            typeof signed === "string" ? signed : signed.signedTransaction;
          if (!bytes)
            throw new Error("Wallet did not return signed transaction bytes");
          return [bytes];
        }
        case "wallet_calls":
          throw new Error("Wallet call batches are sent, not signed");
        case "svm_message":
          throw new Error("Agent wallets sign Solana messages on the server");
      }
    },
    async walletBroadcast(commit, bytes) {
      if (commit.chain_family === "evm") {
        if (!wallets.evm?.broadcastTransaction)
          throw new Error("Wallet broadcaster unavailable");
        return wallets.evm.broadcastTransaction(
          bytes,
          Number(commit.chain_ref),
        );
      }
      if (!wallets.svm?.broadcastTransaction)
        throw new Error("Wallet broadcaster unavailable");
      return wallets.svm.broadcastTransaction(bytes, commit.chain_ref);
    },
  };
}

/** Which commit routes a controller talks to. `ref` is the thread-less
 * `/v1/commits/:ref` family: no X-Thread-Id, no thread ownership check, and
 * every write names the version (and review digest) it was reviewed at. */
export type CommitRouteFamily = "agent" | "pipeline" | "ref";

/** A view cache, not another lifecycle. GET /commits is authoritative after
 * reconnects, lost responses, signing and external submissions. */
export class CommitController {
  private views = new Map<string, CommitView>();
  /** Compatibility reviews cover tool-result races and historical SVM rows.
   * Remove this map once every readable CommitView has a durable review. */
  private reviews = new Map<string, CommitReview>();
  private synthesizedReviews = new Set<string>();
  private snapshot: readonly CommitView[] = [];
  private listeners = new Set<() => void>();
  private attempts = new Map<
    string,
    {
      promise: Promise<CommitView>;
      kind: "execute" | "submitSigned" | "submitBroadcast";
      review?: CommitExecutionReview;
    }
  >();
  private submissionPhases = new Map<string, CommitSubmissionPhase>();
  private onChain = new Map<string, OnChainOutcome>();
  private receiptWatches = new Map<string, AbortController>();
  private phaseGenerations = new Map<string, symbol>();
  private pending = new Map<string, CommitManual>();
  private timer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private capabilityChangeScheduled = false;
  private closed = false;
  private walletCapabilities: Pick<
    CommitCapabilities,
    "sign" | "walletBroadcast"
  > = {};

  constructor(
    private client: AomiClient,
    readonly threadId: string,
    private capabilities: CommitCapabilities = {},
    private readonly routeFamily: CommitRouteFamily = "agent",
  ) {}
  /** Thread-scoped families reject views from other threads; refs have none. */
  private get threadBound(): boolean {
    return this.routeFamily !== "ref";
  }
  /** Recovery records stay keyed by the commit's thread, so a ref handle and
   * the chat sidebar reconcile the same wallet attempt. */
  private scope(id: string): string {
    return this.threadBound
      ? this.threadId
      : (this.views.get(id)?.thread_id ?? this.threadId);
  }
  all = (): readonly CommitView[] => this.snapshot;
  /** A member of an atomic group shares its leader's phase while it has
   * none of its own. */
  submissionPhase = (id: string): CommitSubmissionPhase | undefined => {
    const view = this.views.get(id);
    const leader = view && this.groupLeader(view);
    return (
      this.submissionPhases.get(id) ??
      (leader && this.submissionPhases.get(leader.commit_id))
    );
  };
  /** The chain's receipt verdict while Commit Service has not settled yet. */
  onChainOutcome = (id: string): OnChainOutcome | undefined =>
    this.onChain.get(id);
  recoveryRecord = (id: string): CommitRecoveryRecord | undefined =>
    this.capabilities.recovery?.load(this.scope(id), id);
  review = (id: string): CommitReview | undefined => {
    const view = this.views.get(id);
    return commitReview(view?.review?.request) ?? this.reviews.get(id);
  };
  /** The plan of the group `view` belongs to. */
  plan = (view: CommitView): GroupPlan =>
    groupPlan(this.leader(view), this.available);
  /** `view` as its card shows it: an unsettled member of an atomic group
   * reads Submitted while its leader is. Its result and hash stay its own. */
  groupView = (view: CommitView): CommitView =>
    this.groupLeader(view)?.state === "submitted"
      ? { ...view, state: "submitted" }
      : view;
  /** The leader whose transient progress `view` shares: they land together
   * and `view` has no result of its own yet. */
  private groupLeader(view: CommitView): CommitView | undefined {
    const leader = this.leader(view);
    return leader !== view && !isTerminalCommit(view) && this.plan(view).atomic
      ? leader
      : undefined;
  }
  private leader(view: CommitView): CommitView {
    const id = view.batch?.ordered_commit_ids[0];
    return (id && id !== view.commit_id && this.views.get(id)) || view;
  }
  /** A later member of a bundle: its leader's attempt runs its call. */
  private bundled(view: CommitView): boolean {
    return (
      Boolean(view.batch?.index) && this.plan(view).transport === "send_calls"
    );
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setCapabilities(capabilities: CommitCapabilities): void {
    const availabilityChanged = !sameCapabilityAvailability(
      this.capabilities,
      capabilities,
      COMMIT_CAPABILITY_KEYS,
    );
    this.capabilities = capabilities;
    if (availabilityChanged) this.scheduleCapabilityChange();
  }
  setWalletCapabilities(
    capabilities: Pick<CommitCapabilities, "sign" | "walletBroadcast">,
  ): void {
    const availabilityChanged = !sameCapabilityAvailability(
      this.walletCapabilities,
      capabilities,
      ["sign", "walletBroadcast"],
    );
    this.walletCapabilities = capabilities;
    if (availabilityChanged) this.scheduleCapabilityChange();
  }
  private scheduleCapabilityChange(): void {
    if (this.capabilityChangeScheduled) return;
    this.capabilityChangeScheduled = true;
    queueMicrotask(() => {
      this.capabilityChangeScheduled = false;
      this.changed();
    });
  }
  private changed(): void {
    if (this.closed) return;
    this.snapshot = [...this.views.values()];
    this.notifyListeners();
  }
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A UI observer cannot interrupt durable commit reconciliation.
      }
    }
  }
  private get available(): CommitCapabilities {
    return { ...this.walletCapabilities, ...this.capabilities };
  }
  ingest(view: CommitView): void {
    if (this.closed || (this.threadBound && view.thread_id !== this.threadId))
      return;
    const existing = this.views.get(view.commit_id);
    if (this.store(view, false) !== existing) this.schedule();
  }
  /** The tool result carrying a review can replay after its view already
   * arrived on an event page, so a new review republishes the snapshot. */
  ingestReview(id: string, review: CommitReview): void {
    if (
      this.closed ||
      (this.reviews.has(id) && !this.synthesizedReviews.has(id))
    )
      return;
    this.reviews.set(id, review);
    this.synthesizedReviews.delete(id);
    this.changed();
  }
  canExecute(view: CommitView): boolean {
    if (view.wallet_attempt?.state === "mismatched") return false;
    if (this.bundled(view)) return false;
    if (this.newAttemptIneligible(view)) return false;
    const recovery = this.capabilities.recovery?.load(
      this.scope(view.commit_id),
      view.commit_id,
    );
    if (
      view.wallet_attempt &&
      recovery?.attemptId === view.wallet_attempt.attempt_id &&
      (hasRecordedOutcome(recovery) ||
        (recovery.callsId && this.available.walletCallsStatus))
    )
      return true;
    const walletSend = this.walletSendPlan(view);
    const canStartWalletSend =
      walletSend &&
      (walletSend.transport === "send_calls" ||
        (this.available.canWalletSend?.(view, walletSend.payload) ?? true));
    switch (view.action?.kind) {
      case "sign":
        return Boolean(
          canStartWalletSend ||
          (this.available.sign &&
            (this.available.canSign?.(view, view.action.payload) ?? true)),
        );
      case "broadcast":
        return Boolean(
          view.broadcaster === "wallet"
            ? this.available.walletBroadcast &&
                (this.available.canWalletBroadcast?.(view) ?? true)
            : view.broadcaster === "venue"
              ? this.available.venueBroadcast
              : undefined,
        );
      case "start_wallet_send":
        return Boolean(canStartWalletSend);
      default:
        return false;
    }
  }
  async refresh(id: string): Promise<CommitView> {
    const view = await this.send<CommitView>("GET", this.paths(id).view);
    if (view.commit_id !== id)
      throw new Error("Commit response identity mismatch");
    const current = this.store(view);
    this.schedule();
    return current;
  }
  execute(id: string, review?: CommitExecutionReview): Promise<CommitView> {
    const running = this.attempts.get(id);
    if (running) {
      if (
        running.kind !== "execute" ||
        running.review?.expectedVersion !== review?.expectedVersion ||
        running.review?.expectedReviewDigest !== review?.expectedReviewDigest
      )
        return Promise.reject(
          new Error("Commit review changed; refresh and review it again"),
        );
      return running.promise;
    }
    const generation = Symbol(id);
    this.phaseGenerations.set(id, generation);
    this.setSubmissionPhase(id, "preparing");
    const attempt = this.perform(id, review).finally(() => {
      this.attempts.delete(id);
      if (this.phaseGenerations.get(id) === generation) {
        this.phaseGenerations.delete(id);
        this.setSubmissionPhase(id, undefined);
      }
    });
    this.attempts.set(id, { promise: attempt, kind: "execute", review });
    return attempt;
  }
  /** Report bytes produced by an external signer for the reviewed version. */
  submitSigned(
    id: string,
    payloads: string[],
    review: CommitExecutionReview,
  ): Promise<CommitView> {
    return this.submitExternal(id, review, "submitSigned", async (view) => {
      if (view.state !== "needs_signature" || view.action?.kind !== "sign")
        throw new Error("Commit is not awaiting external signatures");
      if (!payloadMatchesCommit(view, view.action.payload))
        throw new Error(
          "Prepared commit payload does not match its signer or chain",
        );
      if (
        !Array.isArray(payloads) ||
        payloads.length !== 1 ||
        typeof payloads[0] !== "string" ||
        !payloads[0].trim()
      )
        throw new Error("Commit requires 1 signed payload");
      return this.manual(id, signedWrite(view, payloads), view);
    });
  }
  /** Report a previously broadcast transaction after reviewing its exact ID. */
  submitBroadcast(
    id: string,
    transactionId: string,
    review: CommitExecutionReview,
  ): Promise<CommitView> {
    return this.submitExternal(
      id,
      review,
      "submitBroadcast",
      async (view) => {
        if (
          view.state !== "awaiting_broadcast" ||
          view.action?.kind !== "broadcast"
        )
          throw new Error("Commit is not awaiting external broadcast");
        if (transactionId !== view.action.transaction_id)
          throw new Error(
            "Broadcast transaction does not match the reviewed commit",
          );
        return this.manual(
          id,
          { kind: "broadcast", transaction_id: transactionId },
          view,
        );
      },
      (view) => {
        if (view.state !== "submitted" && view.state !== "confirmed")
          return false;
        if (transactionId !== view.transaction_id)
          throw new Error(
            "Broadcast transaction does not match the reviewed commit",
          );
        return true;
      },
    );
  }
  private submitExternal(
    id: string,
    review: CommitExecutionReview,
    kind: "submitSigned" | "submitBroadcast",
    submit: (view: CommitView) => Promise<CommitView>,
    alreadyReported?: (view: CommitView) => boolean,
  ): Promise<CommitView> {
    if (this.closed) return Promise.reject(new Error("Commit session closed"));
    if (this.attempts.has(id))
      return Promise.reject(
        new Error("A commit operation is already in progress"),
      );
    const attempt = (async () => {
      const view = await this.refresh(id);
      // Receipt observation can outrun a caller's broadcast report. A matching
      // authoritative hash is already the requested outcome; never POST again.
      if (alreadyReported?.(view)) return view;
      this.assertReviewed(view, review);
      if (view.review && review.expectedReviewDigest === undefined)
        throw new Error(
          "Commit review digest is required for external submission",
        );
      if (this.closed) throw new Error("Commit session closed");
      return submit(view);
    })().finally(() => this.attempts.delete(id));
    this.attempts.set(id, { promise: attempt, kind, review });
    return attempt;
  }
  async reject(id: string): Promise<CommitView> {
    return this.manual(id, { kind: "rejected" });
  }
  /** The commit on the thread-less ref route, with its `sign_url` and
   * whether this session may approve it (`can_approve`). Not cached. */
  refView(id: string): Promise<CommitRefView> {
    return this.sendRef<CommitRefView>("GET", commitRefPaths.view(id));
  }
  /**
   * Approve a parked commit (`awaiting_approval`) at the reviewed version and
   * review digest; Aomi then signs with the agent wallet. Always uses the
   * thread-less ref route, so it also works for refs from other threads (a
   * scheduled run). Approving one member approves the whole batch.
   */
  async approve(
    id: string,
    review?: CommitExecutionReview,
  ): Promise<CommitRefView> {
    if (this.closed) throw new Error("Commit session closed");
    // Without an explicit review, approve exactly what this controller shows.
    const shown = review
      ? undefined
      : (this.views.get(id) ?? (await this.refView(id)));
    const body: components["schemas"]["CommitRefApprove"] = {
      version: review?.expectedVersion ?? shown!.version,
      review_digest:
        (review ? review.expectedReviewDigest : shown!.review?.digest) ?? "",
    };
    const view = await this.sendRef<CommitRefView>(
      "POST",
      commitRefPaths.approve(id),
      body,
    );
    if (view.commit_id !== id)
      throw new Error("Commit response identity mismatch");
    if (!this.threadBound || view.thread_id === this.threadId) {
      this.store(view);
      // The other members moved with this one; pick them up now.
      for (const member of view.batch?.ordered_commit_ids ?? [])
        if (member !== id && this.views.has(member))
          void this.refresh(member).catch(() => undefined);
      this.schedule();
    }
    return view;
  }
  close(): void {
    this.closed = true;
    for (const id of [...this.receiptWatches.keys()]) this.dropReceipt(id);
    clearTimeout(this.timer);
    this.listeners.clear();
  }
  private paths(id: string) {
    if (this.routeFamily === "ref")
      return {
        view: commitRefPaths.view(id),
        attempts: commitRefPaths.attempts(id),
        report: (attemptId: string) => commitRefPaths.report(id, attemptId),
      };
    const root =
      this.routeFamily === "pipeline"
        ? "/v1/pipeline/evm/commits"
        : "/api/commits";
    const view = `${root}/${encodeURIComponent(id)}`;
    return {
      view,
      attempts: `${view}/wallet-attempts`,
      report: (attemptId: string) =>
        `${view}/wallet-attempts/${encodeURIComponent(attemptId)}/report`,
    };
  }
  /** Thread families keep the legacy transport and its `HTTP <status>` errors;
   * refs answer typed errors (CommitNotFoundError, CommitStaleError). */
  private async send<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (this.threadBound)
      return this.client.request<T>(method, path, {
        sessionId: this.threadId,
        body,
      });
    return this.sendRef<T>(method, path, body);
  }
  private async sendRef<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.client.requestResponse(method, path, { body });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        // A non-JSON error body still maps by status.
      }
      throw commitRefError(response.status, response.statusText, parsed);
    }
    return (await response.json()) as T;
  }
  private newAttemptIneligible(view: CommitView): boolean {
    // A request ID saved before POST is not proof that an attempt was admitted.
    // Only a durable server attempt or its returned identity may reconcile an
    // older authorization after eligibility changes.
    if (view.wallet_attempt || this.recoveryRecord(view.commit_id)?.attemptId)
      return false;
    const eligibility = reviewEligibility(this.review(view.commit_id));
    return eligibility !== undefined && eligibility.state !== "eligible";
  }
  /** Watch the chain for the sent transactions' receipt so the UI can say
   * "Confirmed on chain" ahead of Commit Service. Display only: it reports
   * nothing and changes no commit state. It ends on the first verdict, when
   * the commit settles or mismatches, on close, or after two minutes. */
  private watchReceipt(view: CommitView, transactionIds: string[]): void {
    const wait = this.available.walletReceipt;
    const id = view.commit_id;
    if (!wait || this.closed || isTerminalCommit(view)) return;
    this.dropReceipt(id);
    const abort = new AbortController();
    this.receiptWatches.set(id, abort);
    const timer = setTimeout(() => abort.abort(), RECEIPT_WATCH_MS);
    const cancelled = new Promise<never>((_, reject) =>
      abort.signal.addEventListener("abort", () => reject(new Error("done")), {
        once: true,
      }),
    );
    void Promise.race([
      Promise.resolve().then(() => wait(view, transactionIds)),
      cancelled,
    ])
      .then(
        (outcome) => {
          if (abort.signal.aborted) return;
          this.onChain.set(id, outcome);
          this.changed();
        },
        () => undefined,
      )
      .finally(() => {
        clearTimeout(timer);
        if (this.receiptWatches.get(id) === abort)
          this.receiptWatches.delete(id);
      });
  }
  private dropReceipt(id: string): void {
    this.receiptWatches.get(id)?.abort();
    this.receiptWatches.delete(id);
    this.onChain.delete(id);
  }
  private setSubmissionPhase(
    id: string,
    phase: CommitSubmissionPhase | undefined,
  ): void {
    if (phase === this.submissionPhases.get(id)) return;
    if (phase) this.submissionPhases.set(id, phase);
    else this.submissionPhases.delete(id);
    this.changed();
  }
  private store(view: CommitView, authoritative = true): CommitView {
    if (this.threadBound && view.thread_id !== this.threadId)
      throw new Error("Commit belongs to another thread");
    const current = this.views.get(view.commit_id);
    if (current) {
      view = mergeCommitView(current, view, authoritative);
      if (view === current) return current;
    }
    if (this.closed) return view;
    this.views.set(view.commit_id, view);
    if (isTerminalCommit(view) || view.wallet_attempt?.state === "mismatched")
      this.dropReceipt(view.commit_id);
    const compatibilityReview = legacySvmReview(view);
    if (compatibilityReview && !this.reviews.has(view.commit_id)) {
      this.reviews.set(view.commit_id, compatibilityReview);
      this.synthesizedReviews.add(view.commit_id);
    }
    this.snapshot = [...this.views.values()];
    this.notifyListeners();
    return view;
  }
  /** `basis` is the view the caller reviewed; ref writes bind its version
   * (and review digest) so a changed commit answers 409 instead of applying. */
  private async manual(
    id: string,
    body: CommitManual,
    basis?: CommitView,
  ): Promise<CommitView> {
    if (this.closed) throw new Error("Commit session closed");
    this.pending.set(id, body);
    const view = this.threadBound
      ? await this.send<CommitView>(
          "POST",
          `${this.paths(id).view}/manual`,
          body,
        )
      : await this.manualByRef(
          id,
          body,
          basis ?? this.views.get(id) ?? (await this.refresh(id)),
        );
    if (view.commit_id !== id)
      throw new Error("Commit response identity mismatch");
    this.pending.delete(id);
    const current = this.store(view);
    this.schedule();
    return current;
  }
  private manualByRef(
    id: string,
    body: CommitManual,
    basis: CommitView,
  ): Promise<CommitView> {
    const version = basis.version;
    const review_digest = basis.review?.digest ?? "";
    switch (body.kind) {
      case "signed":
        return this.send("POST", commitRefPaths.sign(id), {
          version,
          review_digest,
          payloads: body.payloads,
        });
      case "broadcast":
        return this.send("POST", commitRefPaths.broadcast(id), {
          version,
          review_digest,
          transaction_id: body.transaction_id,
        });
      case "rejected":
        return this.send("POST", commitRefPaths.reject(id), { version });
    }
  }
  private async perform(
    id: string,
    review?: CommitExecutionReview,
  ): Promise<CommitView> {
    if (this.closed) throw new Error("Commit session closed");
    let view = await this.refresh(id);
    if (review) {
      this.assertReviewed(view, review);
      if (view.review && review.expectedReviewDigest === undefined)
        throw new Error("Commit review digest is required for execution");
    }
    if (isTerminalCommit(view) || view.state === "submitted") return view;
    view = await this.recoverWalletOutcome(view);
    if (isTerminalCommit(view) || view.state === "submitted") return view;
    // The leader's bundle carries this member; it settles with the leader.
    if (this.bundled(view)) return view;
    if (this.newAttemptIneligible(view))
      throw new Error(
        "Execution is blocked by the current reviewed eligibility",
      );
    const pending = this.pending.get(id);
    if (pending) view = await this.manual(id, pending, view);
    if (this.closed) throw new Error("Commit session closed");
    const walletSend = this.walletSendPlan(view);
    if (walletSend) {
      view = await this.startWalletSend(view, walletSend);
    } else if (view.action?.kind === "sign") {
      const sign = this.available.sign;
      if (!sign)
        throw new Error("This wallet does not support sign-only commits");
      const payloads = await sign(view, view.action.payload);
      if (this.closed) throw new Error("Commit session closed");
      view = await this.manual(id, signedWrite(view, payloads), view);
    }
    if (view.action?.kind === "broadcast") {
      const send =
        view.broadcaster === "wallet"
          ? this.available.walletBroadcast
          : view.broadcaster === "venue"
            ? this.available.venueBroadcast
            : undefined;
      if (!send) return view;
      // Record the expected callback before crossing the external submitter.
      // A lost response is reconciled by Commit Service, never a second send.
      this.pending.set(id, {
        kind: "broadcast",
        transaction_id: view.action.transaction_id,
      });
      const hash = await send(view, view.action.signed_transaction);
      if (hash !== view.action.transaction_id)
        throw new Error("Broadcaster returned a different transaction");
      view = await this.manual(
        id,
        { kind: "broadcast", transaction_id: hash },
        view,
      );
    }
    return view;
  }
  private assertReviewed(
    view: CommitView,
    review: CommitExecutionReview,
  ): void {
    if (view.version !== review.expectedVersion)
      throw new CommitStaleError(
        COMMIT_REF_ERROR_CODES.versionConflict,
        "Commit review changed; refresh and review it again",
      );
    if (
      review.expectedReviewDigest !== undefined &&
      view.review?.digest !== review.expectedReviewDigest
    )
      throw new CommitStaleError(
        COMMIT_REF_ERROR_CODES.digestMismatch,
        "Commit review changed; refresh and review it again",
      );
  }
  private async recoverWalletOutcome(view: CommitView): Promise<CommitView> {
    const recovery = this.capabilities.recovery;
    const attempt = view.wallet_attempt;
    const record = recovery?.load(this.scope(view.commit_id), view.commit_id);
    if (!recovery || !attempt || !record) return view;
    if (
      attempt.state === "mismatched" ||
      (record.attemptId && record.attemptId !== attempt.attempt_id)
    )
      return view;
    const recovered =
      record.attemptId === attempt.attempt_id
        ? record
        : { ...record, attemptId: attempt.attempt_id };
    if (recovered !== record)
      recovery.save(this.scope(view.commit_id), view.commit_id, recovered);
    if (
      !hasRecordedOutcome(recovered) &&
      recovered.callsId &&
      this.available.walletCallsStatus
    ) {
      const outcome = await this.available.walletCallsStatus(
        view,
        recovered.callsId,
      );
      if (
        outcome?.kind === "calls" &&
        outcome.transaction_ids.length &&
        outcome.transaction_ids.every((hash) => hash)
      )
        recovered.transactionIds = outcome.transaction_ids;
      if (
        outcome?.kind === "calls_not_submitted" &&
        outcome.calls_id === recovered.callsId
      )
        recovered.callsNotSubmitted = true;
      recovery.save(this.scope(view.commit_id), view.commit_id, recovered);
    }
    if (!hasRecordedOutcome(recovered)) return view;
    return this.reportWalletOutcome(
      view.commit_id,
      attempt.attempt_id,
      recordedOutcome(recovered),
    );
  }
  /** The wallet send `groupPlan` picked, with the payload and digest it
   * binds; undefined when the commit is signed instead. */
  private walletSendPlan(view: CommitView): WalletSendPlan | undefined {
    const { transport } = groupPlan(view, this.available);
    const action = view.action;
    if (
      (transport !== "send_calls" && transport !== "browser_send") ||
      (action?.kind !== "sign" && action?.kind !== "start_wallet_send") ||
      action.payload.kind !== "evm_transaction"
    )
      return undefined;
    const reviewDigest =
      action.kind === "start_wallet_send"
        ? action.review_digest
        : view.review?.digest;
    return reviewDigest
      ? { transport, payload: action.payload, reviewDigest }
      : undefined;
  }
  private async startWalletSend(
    view: CommitView,
    plan: WalletSendPlan,
  ): Promise<CommitView> {
    const send = this.available.walletSend;
    const sendCalls = this.available.walletSendCalls;
    const preflight = this.available.walletSendPreflight;
    const recovery = this.capabilities.recovery;
    if (
      !recovery ||
      (plan.transport === "send_calls" ? !sendCalls : !send || !preflight)
    )
      throw new Error("This wallet does not support durable prepared sends");
    let record = recovery.load(this.scope(view.commit_id), view.commit_id);
    if (record?.attemptId) {
      if (hasRecordedOutcome(record))
        return this.reportWalletOutcome(
          view.commit_id,
          record.attemptId,
          recordedOutcome(record),
        );
      throw new Error("Wallet send outcome is being reconciled");
    }
    await preflight?.(view, plan.payload);
    if (this.closed) throw new Error("Commit session closed");
    record ??= { clientRequestId: crypto.randomUUID() };
    recovery.save(this.scope(view.commit_id), view.commit_id, record);
    let attempt: CommitWalletAttemptView;
    try {
      attempt = await this.send<CommitWalletAttemptView>(
        "POST",
        this.paths(view.commit_id).attempts,
        {
          version: view.version,
          review_digest: plan.reviewDigest,
          client_request_id: record.clientRequestId,
          transport: plan.transport,
        } satisfies CommitWalletAttemptRequest,
      );
    } catch (error) {
      if (isDefiniteRequestFailure(error))
        recovery.remove(this.scope(view.commit_id), view.commit_id);
      throw error;
    }
    if (attempt.commit_id !== view.commit_id)
      throw new Error("Wallet attempt response identity mismatch");
    if (attempt.transport !== plan.transport)
      throw new Error("Wallet attempt transport mismatch");
    record = { ...record, attemptId: attempt.attempt_id };
    recovery.save(this.scope(view.commit_id), view.commit_id, record);
    if (this.closed) throw new Error("Commit session closed");
    if (!attempt.may_invoke_wallet || !attempt.request)
      throw new Error("Wallet send outcome is being reconciled");
    const request = attempt.request;
    const bundle =
      plan.transport === "send_calls" &&
      request.kind === "wallet_calls" &&
      request.calls.length > 0
        ? request
        : undefined;
    const single =
      plan.transport === "browser_send" && request.kind === "evm_transaction"
        ? request
        : undefined;
    if (!bundle && !single)
      throw new Error("Wallet attempt returned an unsupported payload");
    let transactionIds: string[];
    let rejectionPhase: WalletRejection["phase"];
    const generation = this.phaseGenerations.get(view.commit_id);
    const onPhase = (phase: Exclude<CommitSubmissionPhase, "preparing">) => {
      if (phase === "switching_chain") rejectionPhase = "chain_switch";
      if (phase === "awaiting_wallet" || phase === "submitting")
        rejectionPhase = "transaction_request";
      if (
        generation &&
        this.phaseGenerations.get(view.commit_id) === generation
      )
        this.setSubmissionPhase(view.commit_id, phase);
    };
    try {
      transactionIds = bundle
        ? await sendCalls!(view, bundle, onPhase, (callsId) => {
            record = { ...record!, callsId };
            recovery.save(this.scope(view.commit_id), view.commit_id, record);
          })
        : [await send!(view, single!, onPhase)];
    } catch (error) {
      // Legs a sequential fallback already sent are on chain: report them so
      // Commit Service settles the batch instead of waiting on the attempt.
      const landed =
        plan.transport === "send_calls"
          ? partialWalletExecution(error)?.completedTxHashes
          : undefined;
      if (landed) transactionIds = landed;
      else {
        const callsId = errorChain(error)
          .map((link) => link.callsId)
          .find((id): id is string => typeof id === "string" && id.length > 0);
        record = {
          ...record,
          ...(callsId ? { callsId } : {}),
          walletError: walletFailureMessage(error),
        };
        recovery.save(this.scope(view.commit_id), view.commit_id, record);
        if (!isExplicitWalletRejection(error)) {
          // An accepted bundle may have a definitive status even though its
          // synchronous wait failed. Query it once; preserve the original
          // failure if the query itself cannot establish an outcome.
          if (record.callsId && this.available.walletCallsStatus) {
            try {
              const recovered = await this.recoverWalletOutcome(
                await this.refresh(view.commit_id),
              );
              if (
                isTerminalCommit(recovered) ||
                recovered.state === "submitted"
              )
                return recovered;
            } catch {
              /* Unknown: the durable attempt still blocks resubmission. */
            }
          }
          throw error;
        }
        const rejection = walletRejection(rejectionPhase);
        record = { ...record, rejected: true, rejection };
        recovery.save(this.scope(view.commit_id), view.commit_id, record);
        return this.reportWalletOutcome(
          view.commit_id,
          attempt.attempt_id,
          rejection,
        );
      }
    }
    if (!transactionIds.length || transactionIds.some((id) => !id))
      throw new Error("Wallet returned no transaction hash");
    record =
      plan.transport === "send_calls"
        ? { ...record, transactionIds }
        : { ...record, transactionId: transactionIds[0] };
    recovery.save(this.scope(view.commit_id), view.commit_id, record);
    this.watchReceipt(view, transactionIds);
    return this.reportWalletOutcome(
      view.commit_id,
      attempt.attempt_id,
      recordedOutcome(record),
    );
  }
  private async reportWalletOutcome(
    commitId: string,
    attemptId: string,
    outcome: CommitWalletAttemptOutcome,
  ): Promise<CommitView> {
    const view = await this.send<CommitView>(
      "POST",
      this.paths(commitId).report(attemptId),
      outcome,
    );
    if (view.commit_id !== commitId)
      throw new Error("Commit response identity mismatch");
    this.capabilities.recovery?.remove(this.scope(commitId), commitId);
    const current = this.store(view);
    this.schedule();
    return current;
  }
  private schedule(): void {
    if (
      this.closed ||
      this.timer ||
      this.polling ||
      !this.snapshot.some(needsCommitRefresh)
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.polling = true;
      void Promise.all(
        this.snapshot
          .filter(needsCommitRefresh)
          .map((view) => this.refresh(view.commit_id).catch(() => undefined)),
      ).finally(() => {
        this.polling = false;
        this.schedule();
      });
    }, 1000);
    // A commit handle polls in the background without holding a Node process
    // open; `settled()` is what waits. A chat session keeps its own polling.
    if (this.routeFamily !== "agent")
      (this.timer as { unref?: () => void }).unref?.();
  }
}

function sameCapabilityAvailability(
  left: CommitCapabilities,
  right: CommitCapabilities,
  keys: readonly (keyof CommitCapabilities)[],
): boolean {
  return keys.every((key) => Boolean(left[key]) === Boolean(right[key]));
}
