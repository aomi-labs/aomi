import type { AomiClient } from "../client";
import {
  CommitController,
  commitCapabilities,
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

  async refresh(): Promise<CommitRefView> {
    return (await this.controller.refresh(this.ref)) as CommitRefView;
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

  /** Reject at the current version. */
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
    try {
      await controller.refresh(ref);
    } catch (error) {
      controller.close();
      throw error;
    }
    return new CommitHandle(ref, controller);
  }
}
