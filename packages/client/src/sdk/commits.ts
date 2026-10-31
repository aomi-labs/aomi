import { AomiError } from "../api-error";
import type { AomiClient } from "../client";
import {
  CommitController,
  commitCapabilities,
  isTerminalCommit,
  type CommitCapabilities,
  type CommitExecutionReview,
  type CommitRecoveryRecord,
  type CommitReview,
  type CommitSubmissionPhase,
  type CommitView,
  type OnChainOutcome,
} from "../commits";
import type { CommitRefView } from "../commit-ref";
import type { Wallets } from "../wallet/types";

export type CommitKind = `${"evm" | "svm"}_${"tx" | "message"}`;

/** Where a commit's batch stands; see `CommitHandle.settlement`. */
export type CommitSettlement = {
  done: boolean;
  confirmed: boolean;
  failed?: CommitRefView;
  last: CommitRefView;
};

/** A wallet, or the commit operations already adapted from one. */
export type CommitSigner = Wallets | CommitCapabilities;

function capabilitiesOf(signer: CommitSigner): CommitCapabilities {
  return "evm" in signer || "svm" in signer
    ? commitCapabilities(signer as Wallets)
    : (signer as CommitCapabilities);
}

/**
 * One commit opened by its ref, without a thread. The view stays current
 * (GET polling while it is live) until `close()`.
 */
export class CommitHandle {
  /** The view the caller was handed or last reviewed; `sign()` and
   * `approve()` name its version, so a commit that changed since fails as
   * commit_stale instead of signing what nobody saw. */
  private reviewed?: CommitView;

  constructor(
    readonly ref: string,
    private readonly controller: CommitController,
  ) {
    this.reviewed = controller.all().find((view) => view.commit_id === ref);
  }

  /** The latest authoritative view. */
  get view(): CommitRefView {
    const view = this.controller
      .all()
      .find((candidate) => candidate.commit_id === this.ref);
    if (!view) throw new Error("Commit handle has no view");
    return view as CommitRefView;
  }

  /**
   * Every member of this commit's batch in order (just this commit when it
   * has none). A withdraw of two assets, or any ordered batch, is one
   * operation: follow `settled`, not `view`, to know when it is over.
   */
  get batch(): CommitRefView[] {
    const ids = this.view.batch?.ordered_commit_ids ?? [this.ref];
    const views = this.controller.all() as CommitRefView[];
    return ids.flatMap(
      (id) => views.find((view) => view.commit_id === id) ?? [],
    );
  }

  /**
   * Where the whole batch stands: `done` once every member is terminal,
   * `confirmed` only when every one confirmed, and the first member that
   * did not (failed, rejected, expired) once done.
   */
  get settlement(): CommitSettlement {
    const batch = this.batch;
    const done = batch.every(isTerminalCommit);
    const failed = done
      ? batch.find((view) => view.state !== "confirmed")
      : undefined;
    return {
      done,
      confirmed: done && !failed,
      failed,
      last: batch[batch.length - 1] ?? this.view,
    };
  }

  /**
   * Wait until the whole batch is over, following the handle's own polling.
   * Answers the last member once every one confirmed; rejects with a
   * CommitSettleError for the first that did not, or with the signal's
   * reason.
   */
  settled(options: { signal?: AbortSignal } = {}): Promise<CommitRefView> {
    const { signal } = options;
    return new Promise((resolve, reject) => {
      // The poll timer does not hold a Node process open; a waiter does.
      const keepAlive = setInterval(() => undefined, 2 ** 30);
      let off = () => {};
      const finish = (done: () => void) => {
        clearInterval(keepAlive);
        off();
        signal?.removeEventListener("abort", abort);
        done();
      };
      const abort = () => finish(() => reject(signal!.reason));
      const check = () => {
        const { done, failed, last } = this.settlement;
        if (done)
          finish(() =>
            failed ? reject(new CommitSettleError(failed)) : resolve(last),
          );
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      off = this.subscribe(check);
      check();
      // Starts the controller's polling if nothing else did.
      this.controller
        .refresh(this.ref)
        .catch((error: unknown) => finish(() => reject(error)));
    });
  }

  /** evm_tx · evm_message · svm_tx · svm_message */
  get kind(): CommitKind {
    const view = this.view;
    const payload =
      view.action && "payload" in view.action
        ? view.action.payload.kind
        : undefined;
    const message =
      view.review?.request.type === "sign" ||
      Boolean(payload?.endsWith("_message")) ||
      typeof view.signature === "string";
    return `${view.chain_family}_${message ? "message" : "tx"}`;
  }

  get state(): CommitRefView["state"] {
    return this.view.state;
  }

  /** The Aomi page where a person reviews, signs or approves it. */
  get signUrl(): string | undefined {
    return this.view.sign_url;
  }

  /**
   * The batch member to follow now: the first live one, as its own handle,
   * once it asks for a wallet step or is in flight (this handle otherwise). A
   * sequential batch signs each member against its own review and version.
   */
  get next(): CommitHandle {
    const live = this.batch.find((view) => !isTerminalCommit(view));
    return live &&
      live.commit_id !== this.ref &&
      (live.action || live.state === "submitted")
      ? new CommitHandle(live.commit_id, this.controller)
      : this;
  }

  /** The durable review in the Action vocabulary TransactionReview renders. */
  get review(): CommitReview | undefined {
    this.reviewed = this.view;
    return this.controller.review(this.ref);
  }

  /** The local wallet step while `sign()` runs. */
  get submissionPhase(): CommitSubmissionPhase | undefined {
    return this.controller.submissionPhase(this.ref);
  }

  /** The chain's receipt verdict ahead of Commit Service, while it lasts. */
  get onChain(): OnChainOutcome | undefined {
    return this.controller.onChainOutcome(this.ref);
  }

  get recoveryRecord(): CommitRecoveryRecord | undefined {
    return this.controller.recoveryRecord(this.ref);
  }

  /** Whether `signer` (or the configured one) can take the next step now. */
  canSign(signer?: CommitSigner): boolean {
    if (signer) this.controller.setCapabilities(capabilitiesOf(signer));
    return this.controller.canExecute(this.view);
  }

  subscribe(listener: () => void): () => void {
    return this.controller.subscribe(listener);
  }

  /** Refresh every member of the batch; answers this commit's view. */
  async refresh(): Promise<CommitRefView> {
    const view = (await this.controller.refresh(this.ref)) as CommitRefView;
    this.reviewed = view;
    await Promise.all(
      (view.batch?.ordered_commit_ids ?? [])
        .filter((id) => id !== this.ref)
        .map((id) => this.controller.refresh(id)),
    );
    return view;
  }

  /**
   * Run the existing wallet flow for the reviewed version. Every write names
   * that version and review digest; a changed commit raises CommitStaleError
   * before any wallet prompt, or from the server's 409.
   */
  async sign(
    signer?: CommitSigner,
    review: CommitExecutionReview = reviewOf(this.reviewed ?? this.view),
  ): Promise<CommitRefView> {
    if (signer) this.controller.setCapabilities(capabilitiesOf(signer));
    return (await this.controller.execute(this.ref, review)) as CommitRefView;
  }

  /**
   * Approve a parked commit (`awaiting_approval`) at the current version and
   * review digest; Aomi then signs with the agent wallet. Approving one member
   * of a batch approves the whole batch. A portal or CLI login may approve,
   * and an OAuth client its own commits where its lane is Ask in that client;
   * otherwise CommitApprovalForbiddenError: hand the human `view.sign_url`.
   * A changed commit raises CommitStaleError, an expired one
   * CommitExpiredError (nothing was signed). Pass the view the human saw so
   * a commit that changed after it was shown is refused, not approved.
   */
  approve(shown?: CommitRefView): Promise<CommitRefView> {
    return this.controller.approve(
      this.ref,
      reviewOf(shown ?? this.reviewed ?? this.view),
    );
  }

  /** Reject at the current version (every parked member of a batch). */
  async reject(): Promise<CommitRefView> {
    return (await this.controller.reject(this.ref)) as CommitRefView;
  }

  close(): void {
    this.controller.close();
  }
}

function reviewOf(view: CommitView): CommitExecutionReview {
  return {
    expectedVersion: view.version,
    expectedReviewDigest: view.review?.digest,
  };
}

/** A commit that ended without confirming. `code` is its failure code (else
 * `commit_<state>`); `view` is the member that did not confirm. */
export class CommitSettleError extends AomiError {
  constructor(readonly view: CommitRefView) {
    super(
      view.failure_code ?? `commit_${view.state}`,
      `Commit ${view.commit_id} ${view.state}${view.failure_code ? `: ${view.failure_code}` : ""}`,
    );
    this.name = "CommitSettleError";
  }
}

/** The one Commit: transactions and messages, EVM and Solana. */
export const Commit = CommitHandle;
export type Commit = CommitHandle;

/** `aomi.commits`: thread-less access to the caller's own commits. */
export class AomiCommits {
  constructor(
    private readonly client: AomiClient,
    private readonly capabilities: CommitCapabilities = {},
  ) {}

  /**
   * Open a commit by ref. A ref that does not exist or belongs to another
   * account raises CommitNotFoundError.
   */
  async get(
    ref: string,
    options: { signer?: CommitSigner } = {},
  ): Promise<CommitHandle> {
    if (!ref.trim()) throw new TypeError("Commit ref is required");
    const controller = new CommitController(
      this.client,
      "",
      options.signer ? capabilitiesOf(options.signer) : this.capabilities,
      "ref",
    );
    const handle = new CommitHandle(ref, controller);
    try {
      // The other members of its batch too, so approval and polling follow
      // the whole operation.
      await handle.refresh();
    } catch (error) {
      controller.close();
      throw error;
    }
    return handle;
  }
}
