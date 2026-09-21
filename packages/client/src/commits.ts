import type { AomiClient } from "./client";
import type { Wallets } from "./wallet/types";
import type { components } from "./generated/agent-v1/types";
import type { ActionRequest } from "./agent/types";

export type CommitView = components["schemas"]["CommitView"];
export type CommitState = CommitView["state"];
export type CommitAction = NonNullable<CommitView["action"]>;
export type SignableCommit = components["schemas"]["SignableCommit"];
export type CommitWalletAttemptRequest =
  components["schemas"]["CommitWalletAttemptRequest"];
export type CommitWalletAttemptView =
  components["schemas"]["CommitWalletAttemptView"];
export type CommitWalletAttemptOutcome =
  components["schemas"]["CommitWalletAttemptOutcome"];
export type EvmCommitTransaction = Extract<
  SignableCommit,
  { kind: "evm_transaction" }
>["transaction"];
/** Simulated effects of one commit, in the vocabulary the wallet review
 * already renders. Commit Service views carry the signable, never its effects. */
export type CommitReview = Extract<
  ActionRequest,
  { type: "execute_evm" | "execute_svm" }
>;
export type CommitManual =
  | { kind: "signed"; payloads: string[] }
  | { kind: "broadcast"; transaction_id: string }
  | { kind: "rejected" };
export type CommitRecoveryRecord = {
  clientRequestId: string;
  attemptId?: string;
  transactionId?: string;
  rejected?: true;
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
/** Sign only. Submission always uses the bytes returned by Commit Service. */
export type CommitCapabilities = {
  sign?: (commit: CommitView, payload: SignableCommit) => Promise<string[]>;
  walletBroadcast?: (
    commit: CommitView,
    signedBytes: string,
  ) => Promise<string>;
  venueBroadcast?: (commit: CommitView, signedBytes: string) => Promise<string>;
  walletSend?: (
    commit: CommitView,
    payload: Extract<SignableCommit, { kind: "evm_transaction" }>,
  ) => Promise<string>;
  recovery?: CommitRecoveryStore;
};
export const isTerminalCommit = (view: CommitView): boolean =>
  ["confirmed", "rejected", "failed", "expired"].includes(view.state);

function commitReview(value: unknown): CommitReview | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type !== "execute_evm" && value.type !== "execute_svm")
    return undefined;
  if (!isRecordArray(value.transactions) || !isRecord(value.simulation))
    return undefined;
  const simulation = value.simulation;
  if (
    (simulation.status !== "passed" && simulation.status !== "failed") ||
    !isRecordArray(simulation.balanceChanges) ||
    !isRecordArray(simulation.approvals) ||
    !isRecordArray(simulation.fees) ||
    !isRecordArray(simulation.guards) ||
    !isRecordArray(simulation.logs) ||
    !isStringArray(simulation.warnings) ||
    (simulation.gas !== null && !isRecord(simulation.gas))
  )
    return undefined;
  return value as CommitReview;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isExplicitWalletRejection(error: unknown): boolean {
  const seen = new Set<object>();
  let candidate = error;
  while (candidate && typeof candidate === "object" && !seen.has(candidate)) {
    seen.add(candidate);
    const current = candidate as { code?: unknown; cause?: unknown };
    if (current.code === 4001) return true;
    candidate = current.cause;
  }
  return false;
}

export function commitCapabilities(
  wallets: Wallets,
  recovery?: CommitRecoveryStore,
): CommitCapabilities {
  const evm = wallets.evm;
  const sendPrepared = evm?.sendPreparedTransaction;
  return {
    recovery,
    ...(evm && sendPrepared
      ? {
          async walletSend(commit, payload) {
            if (commit.chain_family !== "evm")
              throw new Error("External wallet send requires an EVM commit");
            if (evm.address.toLowerCase() !== commit.signer.toLowerCase())
              throw new Error("Connect the expected signing wallet");
            await evm.switchChain?.(payload.chain_id);
            return sendPrepared(payload);
          },
        }
      : {}),
    async sign(commit, payload) {
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
        case "user_operation": {
          if (!wallets.evm?.signMessage)
            throw new Error("Wallet does not support owner signatures");
          await wallets.evm.switchChain?.(payload.chain_id);
          const outputs: string[] = [];
          for (const request of payload.requests) {
            if (request.kind !== "personal_sign")
              throw new Error("Unsupported owner authorization");
            const signed = await wallets.evm.signMessage({
              message: request.message,
              chainId: payload.chain_id,
            });
            outputs.push(
              typeof signed === "string" ? signed : signed.signature,
            );
          }
          return outputs;
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

/** A view cache, not another lifecycle. GET /commits is authoritative after
 * reconnects, lost responses, signing and external submissions. */
export class CommitController {
  private views = new Map<string, CommitView>();
  private reviews = new Map<string, CommitReview>();
  private snapshot: readonly CommitView[] = [];
  private listeners = new Set<() => void>();
  private attempts = new Map<string, Promise<CommitView>>();
  private pending = new Map<string, CommitManual>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private walletCapabilities: Pick<
    CommitCapabilities,
    "sign" | "walletBroadcast"
  > = {};

  constructor(
    private client: AomiClient,
    readonly threadId: string,
    private capabilities: CommitCapabilities = {},
  ) {}
  all = (): readonly CommitView[] => this.snapshot;
  review = (id: string): CommitReview | undefined =>
    commitReview(this.views.get(id)?.review?.request) ?? this.reviews.get(id);
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  setCapabilities(capabilities: CommitCapabilities): void {
    this.capabilities = capabilities;
    this.changed();
  }
  setWalletCapabilities(
    capabilities: Pick<CommitCapabilities, "sign" | "walletBroadcast">,
  ): void {
    this.walletCapabilities = capabilities;
    this.changed();
  }
  private changed(): void {
    if (this.closed) return;
    this.snapshot = [...this.views.values()];
    this.listeners.forEach((listener) => listener());
  }
  private get available(): CommitCapabilities {
    return { ...this.walletCapabilities, ...this.capabilities };
  }
  ingest(view: CommitView): void {
    if (this.closed || view.thread_id !== this.threadId) return;
    const existing = this.views.get(view.commit_id);
    // A replayed tool result cannot roll a live/terminal view backwards.
    if (existing && existing.version >= view.version) return;
    this.store(view);
    this.schedule();
  }
  /** The tool result carrying a review can replay after its view already
   * arrived on an event page, so a new review republishes the snapshot. */
  ingestReview(id: string, review: CommitReview): void {
    if (this.closed || this.reviews.has(id)) return;
    this.reviews.set(id, review);
    this.changed();
  }
  canExecute(view: CommitView): boolean {
    if (view.wallet_attempt?.state === "mismatched") return false;
    const recovery = this.capabilities.recovery?.load(
      this.threadId,
      view.commit_id,
    );
    if (
      view.wallet_attempt &&
      recovery?.attemptId === view.wallet_attempt.attempt_id &&
      (recovery.transactionId || recovery.rejected)
    )
      return true;
    switch (view.action?.kind) {
      case "sign":
        return Boolean(this.available.sign);
      case "broadcast":
        return Boolean(
          view.broadcaster === "wallet"
            ? this.available.walletBroadcast
            : view.broadcaster === "venue"
              ? this.available.venueBroadcast
              : undefined,
        );
      case "start_wallet_send":
        return Boolean(
          view.action.payload.kind === "evm_transaction" &&
          this.available.walletSend &&
          this.capabilities.recovery,
        );
      default:
        return false;
    }
  }
  async refresh(id: string): Promise<CommitView> {
    const view = await this.client.request<CommitView>("GET", this.path(id), {
      sessionId: this.threadId,
    });
    if (view.commit_id !== id)
      throw new Error("Commit response identity mismatch");
    return this.store(view);
  }
  execute(id: string): Promise<CommitView> {
    const running = this.attempts.get(id);
    if (running) return running;
    const attempt = this.perform(id).finally(() => {
      this.attempts.delete(id);
    });
    this.attempts.set(id, attempt);
    return attempt;
  }
  async reject(id: string): Promise<CommitView> {
    return this.manual(id, { kind: "rejected" });
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
  private path(id: string): string {
    return `/api/commits/${encodeURIComponent(id)}`;
  }
  private store(view: CommitView): CommitView {
    if (view.thread_id !== this.threadId)
      throw new Error("Commit belongs to another thread");
    const current = this.views.get(view.commit_id);
    if (current && current.version > view.version) return current;
    if (this.closed) return view;
    this.views.set(view.commit_id, view);
    this.snapshot = [...this.views.values()];
    this.listeners.forEach((listener) => listener());
    return view;
  }
  private async manual(id: string, body: CommitManual): Promise<CommitView> {
    if (this.closed) throw new Error("Commit session closed");
    this.pending.set(id, body);
    const view = await this.client.request<CommitView>(
      "POST",
      `${this.path(id)}/manual`,
      { sessionId: this.threadId, body },
    );
    if (view.commit_id !== id)
      throw new Error("Commit response identity mismatch");
    this.pending.delete(id);
    const current = this.store(view);
    this.schedule();
    return current;
  }
  private async perform(id: string): Promise<CommitView> {
    if (this.closed) throw new Error("Commit session closed");
    let view = await this.refresh(id);
    if (isTerminalCommit(view) || view.state === "submitted") return view;
    view = await this.recoverWalletOutcome(view);
    if (isTerminalCommit(view) || view.state === "submitted") return view;
    const pending = this.pending.get(id);
    if (pending) view = await this.manual(id, pending);
    if (view.action?.kind === "sign") {
      const sign = this.available.sign;
      if (!sign)
        throw new Error("This wallet does not support sign-only commits");
      const payloads = await sign(view, view.action.payload);
      if (this.closed) throw new Error("Commit session closed");
      view = await this.manual(id, { kind: "signed", payloads });
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
      view = await this.manual(id, { kind: "broadcast", transaction_id: hash });
    }
    if (view.action?.kind === "start_wallet_send") {
      view = await this.startWalletSend(view);
    }
    return view;
  }
  private async recoverWalletOutcome(view: CommitView): Promise<CommitView> {
    const recovery = this.capabilities.recovery;
    const attempt = view.wallet_attempt;
    const record = recovery?.load(this.threadId, view.commit_id);
    if (!recovery || !attempt || !record) return view;
    if (attempt.state === "mismatched") return view;
    const recovered =
      record.attemptId === attempt.attempt_id
        ? record
        : { ...record, attemptId: attempt.attempt_id };
    if (recovered !== record)
      recovery.save(this.threadId, view.commit_id, recovered);
    if (!recovered.transactionId && !recovered.rejected) return view;
    return this.reportWalletOutcome(
      view.commit_id,
      attempt.attempt_id,
      recovered.transactionId
        ? { kind: "transaction", transaction_id: recovered.transactionId }
        : { kind: "rejected" },
    );
  }
  private async startWalletSend(view: CommitView): Promise<CommitView> {
    const action = view.action;
    if (
      action?.kind !== "start_wallet_send" ||
      action.payload.kind !== "evm_transaction"
    )
      return view;
    const send = this.available.walletSend;
    const recovery = this.capabilities.recovery;
    if (!send || !recovery)
      throw new Error("This wallet does not support durable prepared sends");
    let record = recovery.load(this.threadId, view.commit_id);
    if (record?.attemptId) {
      if (record.transactionId || record.rejected)
        return this.reportWalletOutcome(
          view.commit_id,
          record.attemptId,
          record.transactionId
            ? { kind: "transaction", transaction_id: record.transactionId }
            : { kind: "rejected" },
        );
      throw new Error("Wallet send outcome is being reconciled");
    }
    record ??= { clientRequestId: crypto.randomUUID() };
    recovery.save(this.threadId, view.commit_id, record);
    const attempt = await this.client.request<CommitWalletAttemptView>(
      "POST",
      `${this.path(view.commit_id)}/wallet-attempts`,
      {
        sessionId: this.threadId,
        body: {
          version: view.version,
          review_digest: action.review_digest,
          client_request_id: record.clientRequestId,
        } satisfies CommitWalletAttemptRequest,
      },
    );
    if (attempt.commit_id !== view.commit_id)
      throw new Error("Wallet attempt response identity mismatch");
    record = { ...record, attemptId: attempt.attempt_id };
    recovery.save(this.threadId, view.commit_id, record);
    if (!attempt.may_invoke_wallet || !attempt.request)
      throw new Error("Wallet send outcome is being reconciled");
    if (attempt.request.kind !== "evm_transaction")
      throw new Error("Wallet attempt returned an unsupported payload");
    let transactionId: string;
    try {
      transactionId = await send(view, attempt.request);
    } catch (error) {
      if (!isExplicitWalletRejection(error)) throw error;
      record = { ...record, rejected: true };
      recovery.save(this.threadId, view.commit_id, record);
      return this.reportWalletOutcome(view.commit_id, attempt.attempt_id, {
        kind: "rejected",
      });
    }
    if (!transactionId) throw new Error("Wallet returned no transaction hash");
    record = { ...record, transactionId };
    recovery.save(this.threadId, view.commit_id, record);
    return this.reportWalletOutcome(view.commit_id, attempt.attempt_id, {
      kind: "transaction",
      transaction_id: transactionId,
    });
  }
  private async reportWalletOutcome(
    commitId: string,
    attemptId: string,
    outcome: CommitWalletAttemptOutcome,
  ): Promise<CommitView> {
    const view = await this.client.request<CommitView>(
      "POST",
      `${this.path(commitId)}/wallet-attempts/${encodeURIComponent(attemptId)}/report`,
      { sessionId: this.threadId, body: outcome },
    );
    if (view.commit_id !== commitId)
      throw new Error("Commit response identity mismatch");
    this.capabilities.recovery?.remove(this.threadId, commitId);
    const current = this.store(view);
    this.schedule();
    return current;
  }
  private schedule(): void {
    if (
      this.closed ||
      this.timer ||
      !this.snapshot.some((view) => !isTerminalCommit(view))
    )
      return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void Promise.all(
        this.snapshot
          .filter((view) => !isTerminalCommit(view))
          .map((view) => this.refresh(view.commit_id).catch(() => undefined)),
      ).finally(() => this.schedule());
    }, 1000);
  }
}
