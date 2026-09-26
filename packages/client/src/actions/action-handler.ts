import type { Action, ActionResult } from "../agent/types";
import type { CommitController, CommitView } from "../commits";
import { TypedEventEmitter } from "../event";
import {
  canExecute,
  execute,
  requiresSignatureAdmission,
  MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE,
  type ActionCapabilities,
} from "./capabilities";

export type ActionAttemptState = "executing" | "responding" | "failed";

export type ActionAttempt = {
  actionId: string;
  revision: number;
  state: ActionAttemptState;
  error?: unknown;
};

export type ActionHandlerEvents = {
  changed: readonly Action[];
  attempt_changed: ActionAttempt | undefined;
  resolved: Action;
};

export type ActionResponder = (
  action: Action,
  result: ActionResult,
  idempotencyKey: string,
) => Promise<Action>;

type Attempt = ActionAttempt & {
  controller: AbortController;
  idempotencyKey: string;
  result?: ActionResult;
  promise?: Promise<Action>;
};

/** Owns the client lifecycle of every durable Action in one Agent session. */
export class ActionHandler extends TypedEventEmitter<ActionHandlerEvents> {
  private readonly actions = new Map<string, Action>();
  private readonly attempts = new Map<string, Attempt>();
  private snapshot: Action[] = [];

  constructor(
    private capabilities: ActionCapabilities,
    private readonly respond: ActionResponder,
    private readonly commits?: CommitController,
  ) {
    super();
  }

  ingest(action: Action): boolean {
    const previous = this.actions.get(action.id);
    if (previous && previous.revision >= action.revision) return false;
    this.actions.set(action.id, action);

    const attempt = this.attempts.get(action.id);
    if (
      attempt &&
      (action.revision > attempt.revision || action.state !== "pending")
    ) {
      attempt.controller.abort();
      this.attempts.delete(action.id);
      this.emit("attempt_changed", undefined);
    }
    this.snapshot = [...this.actions.values()].sort(
      (left, right) => left.sequence - right.sequence,
    );
    this.emit("changed", this.snapshot);
    return true;
  }

  get(id: string): Action | undefined {
    return this.actions.get(id);
  }

  all(): readonly Action[] {
    return this.snapshot;
  }

  allAttempts(): ReadonlyMap<string, ActionAttempt> {
    return new Map(
      [...this.attempts].map(([id, attempt]) => [id, publicAttempt(attempt)]),
    );
  }

  pending(): Action[] {
    return this.all().filter((action) => action.state === "pending");
  }

  attempt(id: string): ActionAttempt | undefined {
    const attempt = this.attempts.get(id);
    if (!attempt) return undefined;
    return publicAttempt(attempt);
  }

  isBlocking(): boolean {
    return this.pending().length > 0 || this.attempts.size > 0;
  }

  subscribe(listener: () => void): () => void {
    const actions = this.on("changed", listener);
    const attempts = this.on("attempt_changed", listener);
    return () => {
      actions();
      attempts();
    };
  }

  setCapabilities(capabilities: ActionCapabilities): void {
    this.capabilities = capabilities;
  }

  canExecute(id: string): boolean {
    const action = this.actions.get(id);
    if (
      action?.request.type === "execute_evm" &&
      "commitStages" in action.request
    ) {
      try {
        const next = this.linkedViews(action).find(
          (view) => view.state !== "confirmed",
        );
        return (
          action.state === "pending" &&
          Boolean(next && this.commits?.canExecute(next))
        );
      } catch {
        return false;
      }
    }
    return Boolean(
      action &&
      action.state === "pending" &&
      canExecute(action, this.capabilities),
    );
  }

  execute(id: string): Promise<Action> {
    const linked = this.pendingAction(id);
    if (linkedStages(linked)) return this.executeLinked(linked);
    const current = this.attempts.get(id);
    if (current?.promise) return current.promise;
    if (current?.result)
      return this.sendResult(this.pendingAction(id), current);

    const action = this.pendingAction(id);
    const attempt: Attempt = {
      actionId: action.id,
      revision: action.revision,
      state: "executing",
      controller: new AbortController(),
      idempotencyKey: crypto.randomUUID(),
    };
    this.attempts.set(id, attempt);
    this.emit("attempt_changed", publicAttempt(attempt));

    return this.track(action.id, attempt, async () => {
      try {
        const result = await execute(
          action,
          this.capabilities,
          attempt.controller.signal,
        );
        attempt.result = result;
        return await this.respondWithResult(action, attempt);
      } catch (error) {
        this.fail(attempt, error);
        throw error;
      }
    });
  }

  submitResult(id: string, result: ActionResult): Promise<Action> {
    const current = this.attempts.get(id);
    if (current?.promise) return current.promise;
    const action = this.pendingAction(id);
    if (linkedStages(action))
      throw new Error(
        "Durable transactions report outcomes through Commit Service",
      );
    if (result.status === "signed" && requiresSignatureAdmission(action.request))
      throw new Error(MANUAL_SIGNATURE_ADMISSION_UNAVAILABLE);
    const attempt =
      current ??
      ({
        actionId: action.id,
        revision: action.revision,
        state: "responding",
        controller: new AbortController(),
        idempotencyKey: crypto.randomUUID(),
      } satisfies Attempt);
    attempt.result = result;
    this.attempts.set(id, attempt);
    return this.sendResult(action, attempt);
  }

  reject(id: string, reason = "Request rejected"): Promise<Action> {
    const action = this.pendingAction(id);
    if (linkedStages(action)) return this.rejectLinked(action);
    return this.submitResult(id, { status: "rejected", reason });
  }

  retry(id: string): Promise<Action> {
    const attempt = this.attempts.get(id);
    return attempt?.result
      ? this.sendResult(this.pendingAction(id), attempt)
      : this.execute(id);
  }

  abort(id: string): void {
    const attempt = this.attempts.get(id);
    if (!attempt) return;
    attempt.controller.abort();
    this.attempts.delete(id);
    this.emit("attempt_changed", undefined);
  }

  close(): void {
    for (const attempt of this.attempts.values()) attempt.controller.abort();
    this.attempts.clear();
    this.actions.clear();
    this.snapshot = [];
    this.removeAllListeners();
  }

  private linkedViews(action: Action): CommitView[] {
    const stages = linkedStages(action);
    if (
      !stages ||
      !this.commits ||
      action.request.type !== "execute_evm" ||
      stages.length !== action.request.transactions.length ||
      new Set(stages).size !== stages.length
    ) {
      throw new Error("Durable transaction preparation is still loading");
    }
    const views = stages.map((stage) => {
      const matches = this.commits!.all().filter(
        (view) => view.stage_id === stage,
      );
      if (matches.length !== 1)
        throw new Error("Durable transaction preparation is still loading");
      return matches[0]!;
    });
    if (
      views.some(
        (view, index) =>
          view.thread_id !== this.commits!.threadId ||
          (views.length > 1 &&
            (!view.batch ||
              view.batch.index !== index ||
              view.batch.batch_id !== views[0]!.batch?.batch_id ||
              view.batch.ordered_stage_ids.some(
                (stage, position) => stage !== stages[position],
              ) ||
              view.batch.ordered_stage_ids.length !== stages.length ||
              view.batch.ordered_commit_ids.some(
                (id, position) => id !== views[position]?.commit_id,
              ) ||
              view.batch.ordered_commit_ids.length !== views.length)),
      )
    ) {
      throw new Error("Durable transaction cohort identity mismatch");
    }
    return views;
  }

  private async executeLinked(action: Action): Promise<Action> {
    const views = this.linkedViews(action);
    for (const view of views) {
      const current = await this.commits!.refresh(view.commit_id);
      if (current.state === "confirmed") continue;
      if (current.state === "submitted") return this.get(action.id) ?? action;
      const next = await this.commits!.execute(view.commit_id);
      if (next.state !== "confirmed") break;
    }
    return this.get(action.id) ?? action;
  }

  private async rejectLinked(action: Action): Promise<Action> {
    for (const view of this.linkedViews(action)) {
      const current = await this.commits!.refresh(view.commit_id);
      if (current.state === "confirmed") continue;
      await this.commits!.reject(view.commit_id);
    }
    return this.get(action.id) ?? action;
  }

  private sendResult(action: Action, attempt: Attempt): Promise<Action> {
    if (attempt.promise) return attempt.promise;
    return this.track(action.id, attempt, async () => {
      try {
        return await this.respondWithResult(action, attempt);
      } catch (error) {
        this.fail(attempt, error);
        throw error;
      }
    });
  }

  private respondWithResult(action: Action, attempt: Attempt): Promise<Action> {
    if (!attempt.result) throw new Error(`Action "${action.id}" has no result`);
    attempt.state = "responding";
    attempt.error = undefined;
    this.emit("attempt_changed", publicAttempt(attempt));

    return this.respond(action, attempt.result, attempt.idempotencyKey).then(
      (next) => {
        this.ingest(next);
        this.emit("resolved", next);
        return next;
      },
    );
  }

  private track(
    id: string,
    attempt: Attempt,
    operation: () => Promise<Action>,
  ): Promise<Action> {
    const promise = operation();
    attempt.promise = promise;
    const clear = () => {
      if (this.attempts.get(id) === attempt) attempt.promise = undefined;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private fail(attempt: Attempt, error: unknown): void {
    if (this.attempts.get(attempt.actionId) !== attempt) return;
    attempt.state = "failed";
    attempt.error = error;
    this.emit("attempt_changed", publicAttempt(attempt));
  }

  private pendingAction(id: string): Action {
    const action = this.actions.get(id);
    if (!action || action.state !== "pending") {
      throw new Error(`No pending Action with id "${id}"`);
    }
    return action;
  }
}

function publicAttempt(attempt: Attempt): ActionAttempt {
  return {
    actionId: attempt.actionId,
    revision: attempt.revision,
    state: attempt.state,
    ...(attempt.error === undefined ? {} : { error: attempt.error }),
  };
}

function linkedStages(action: Action): string[] | undefined {
  if (
    action.request.type !== "execute_evm" ||
    !("commitStages" in action.request)
  )
    return undefined;
  const stages = action.request.commitStages;
  if (
    !Array.isArray(stages) ||
    !stages.length ||
    stages.some((stage) => typeof stage !== "string" || !stage)
  )
    throw new Error("Invalid durable transaction references");
  return stages;
}
