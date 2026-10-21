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
} from "../commits";
import type { CommitRefView } from "../commit-ref";
import type { Wallets } from "../wallet/types";

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
  constructor(
    readonly ref: string,
    private readonly controller: CommitController,
  ) {}

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
  get settled(): {
    done: boolean;
    confirmed: boolean;
    failed?: CommitRefView;
    last: CommitRefView;
  } {
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

  /** The durable review in the Action vocabulary TransactionReview renders. */
  get review(): CommitReview | undefined {
    return this.controller.review(this.ref);
  }

  /** The local wallet step while `sign()` runs. */
  get submissionPhase(): CommitSubmissionPhase | undefined {
    return this.controller.submissionPhase(this.ref);
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
    review: CommitExecutionReview = {
      expectedVersion: this.view.version,
      expectedReviewDigest: this.view.review?.digest,
    },
  ): Promise<CommitRefView> {
    if (signer) this.controller.setCapabilities(capabilitiesOf(signer));
    return (await this.controller.execute(this.ref, review)) as CommitRefView;
  }

  /**
   * Approve a parked commit (`awaiting_approval`) at the current version and
   * review digest; Aomi then signs with the agent wallet. Approving one member
   * of a batch approves the whole batch. Only a portal or CLI login may
   * approve: OAuth clients get CommitApprovalForbiddenError and should hand
   * the human `view.sign_url`. A changed commit raises CommitStaleError, an
   * expired one CommitExpiredError (nothing was signed).
   */
  async approve(): Promise<CommitRefView> {
    const view = this.view;
    return this.controller.approve(this.ref, {
      expectedVersion: view.version,
      expectedReviewDigest: view.review?.digest ?? "",
    });
  }

  /** Reject at the current version (every parked member of a batch). */
  async reject(): Promise<CommitRefView> {
    return (await this.controller.reject(this.ref)) as CommitRefView;
  }

  close(): void {
    this.controller.close();
  }
}

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
