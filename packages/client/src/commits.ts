import type { AomiClient } from "./client";
import type { Wallets } from "./wallet/types";
import type { components } from "./generated/agent-v1/types";

export type CommitView = components["schemas"]["CommitView"];
export type CommitState = CommitView["state"];
export type CommitAction = NonNullable<CommitView["action"]>;
export type SignableCommit = components["schemas"]["SignableCommit"];
export type EvmCommitTransaction = Extract<
  SignableCommit,
  { kind: "evm_transaction" }
>["transaction"];
export type CommitManual =
  | { kind: "signed"; payloads: string[] }
  | { kind: "broadcast"; transaction_id: string }
  | { kind: "rejected" };
/** Sign only. Submission always uses the bytes returned by Commit Service. */
export type CommitCapabilities = {
  sign?: (commit: CommitView, payload: SignableCommit) => Promise<string[]>;
  walletBroadcast?: (
    commit: CommitView,
    signedBytes: string,
  ) => Promise<string>;
  venueBroadcast?: (commit: CommitView, signedBytes: string) => Promise<string>;
};
export const isTerminalCommit = (view: CommitView): boolean =>
  ["confirmed", "rejected", "failed", "expired"].includes(view.state);

export function commitCapabilities(wallets: Wallets): CommitCapabilities {
  return {
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
  canExecute(view: CommitView): boolean {
    return view.action?.kind === "sign"
      ? Boolean(this.available.sign)
      : view.action?.kind === "broadcast" &&
          Boolean(
            view.broadcaster === "wallet"
              ? this.available.walletBroadcast
              : view.broadcaster === "venue"
                ? this.available.venueBroadcast
                : undefined,
          );
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
    return view;
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
