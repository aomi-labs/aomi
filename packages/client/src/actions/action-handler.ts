import type { Action, ActionResult } from "../agent/types";
import { TypedEventEmitter } from "../event";
import { canExecute, execute, type ActionCapabilities } from "./capabilities";

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
    return Boolean(
      action &&
      action.state === "pending" &&
      canExecute(action, this.capabilities),
    );
  }

  execute(id: string): Promise<Action> {
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

    return this.respond(action, attempt.result, attempt.idempotencyKey).then((next) => {
      this.ingest(next);
      this.emit("resolved", next);
      return next;
    });
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
