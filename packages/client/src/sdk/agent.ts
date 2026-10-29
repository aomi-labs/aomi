import type { Action, ActionResult } from "../agent/types";
import type { ActionCapabilities } from "../actions";
import type { AomiClient } from "../client";
import {
  isTerminalCommit,
  type CommitCapabilities,
  type CommitView,
} from "../commits";
import { TypedEventEmitter } from "../event";
import { ClientSession } from "../session";
import type { SendResult, SessionOptions } from "../session/types";
import type { UserState as UserStateShape } from "../user-state";
import { AomiCommits } from "./commits";
import { Thread, type ThreadSummary } from "./thread";

export interface AgentRunOptions extends Omit<
  SessionOptions,
  "userState" | "sessionId"
> {
  sessionId?: string;
  userState?: UserStateShape;
}

export interface AgentRunResult extends SendResult {
  sessionId: string;
  /** Same as `sessionId`. */
  threadId: string;
  /** The agent's last answer. */
  reply: string;
  actions: readonly Action[];
  commits: readonly CommitView[];
}

export interface AgentRunEventMap extends Record<string, unknown> {
  action: Action;
  commit: CommitView;
  completed: AgentRunResult;
  error: { error: unknown };
}

/** One stateful Agent turn. It is both event-driven and Promise-like. */
export class AgentRun
  extends TypedEventEmitter<AgentRunEventMap>
  implements PromiseLike<AgentRunResult>
{
  readonly session: ClientSession;
  private readonly completion: Promise<AgentRunResult>;
  constructor(
    client: AomiClient,
    prompt: string,
    actions: ActionCapabilities,
    options: AgentRunOptions = {},
  ) {
    super();
    const userState = options.userState;
    this.session = new ClientSession(client, {
      ...options,
      actions,
      getUserState: () => userState,
    });
    const revisions = new Map<string, number>();
    const commitVersions = new Map<string, number>();
    let reportedError: unknown;
    const unsubscribe = this.session.subscribe(() => {
      const snapshot = this.session.getSnapshot();
      for (const action of snapshot.actions) {
        if ((revisions.get(action.id) ?? -1) >= action.revision) continue;
        revisions.set(action.id, action.revision);
        this.emit("action", action);
      }
      for (const commit of snapshot.commits) {
        if ((commitVersions.get(commit.commit_id) ?? -1) >= commit.version)
          continue;
        commitVersions.set(commit.commit_id, commit.version);
        this.emit("commit", commit);
      }
      if (snapshot.error !== undefined && snapshot.error !== reportedError) {
        reportedError = snapshot.error;
        this.emit("error", { error: snapshot.error });
      }
    });
    this.completion = Promise.resolve()
      .then(() => this.sendUntilCompletionOrCommit(prompt))
      .then((result) => {
        const completed = {
          ...result,
          sessionId: this.session.sessionId,
          threadId: this.session.sessionId,
          reply:
            result.messages.findLast(
              (message) =>
                message.sender === "agent" &&
                !message.tool_result &&
                message.content.trim(),
            )?.content ?? "",
          actions: this.session.actions.all(),
          commits: this.session.commits.all(),
        };
        this.emit("completed", completed);
        unsubscribe();
        this.session.close();
        return completed;
      })
      .catch((error: unknown) => {
        this.emit("error", { error });
        unsubscribe();
        this.session.close();
        throw error;
      });
    void this.completion.catch(() => undefined);
  }

  result(): Promise<AgentRunResult> {
    return this.completion;
  }

  private async sendUntilCompletionOrCommit(
    prompt: string,
  ): Promise<SendResult> {
    let unsubscribe: () => void = () => undefined;
    const handoff = new Promise<SendResult>((resolve) => {
      const check = () => {
        const snapshot = this.session.getSnapshot();
        if (
          snapshot.turnState !== "awaiting_action" ||
          snapshot.actions.some((action) => action.state === "pending") ||
          !snapshot.commits.some((commit) => !isTerminalCommit(commit))
        )
          return;
        resolve({ messages: snapshot.messages, title: snapshot.title });
      };
      unsubscribe = this.session.subscribe(check);
      check();
    });
    try {
      return await Promise.race([this.session.send(prompt), handoff]);
    } finally {
      unsubscribe();
    }
  }

  then<TResult1 = AgentRunResult, TResult2 = never>(
    onfulfilled?:
      | ((value: AgentRunResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.completion.then(onfulfilled, onrejected);
  }

  interrupt(): Promise<void> {
    return this.session.interrupt();
  }

  respond(actionId: string, result: ActionResult): Promise<Action> {
    return this.session.actions.submitResult(actionId, result);
  }

  reject(actionId: string, reason?: string): Promise<Action> {
    return this.session.actions.reject(actionId, reason);
  }
}

export class AomiAgent {
  /** The account's threads, newest first. */
  readonly threads: {
    list(options?: {
      cursor?: string;
      limit?: number;
      signal?: AbortSignal;
    }): Promise<{ threads: ThreadSummary[]; nextCursor?: string }>;
  };

  constructor(
    readonly raw: AomiClient["agent"],
    private readonly client: AomiClient,
    private readonly actions: ActionCapabilities = {},
    private readonly defaultUserState: () => UserStateShape | undefined = () =>
      undefined,
    private readonly commits: CommitCapabilities = {},
  ) {
    this.threads = {
      list: async (options) => {
        const page = await raw.sessions.list(options);
        return {
          threads: page.sessions,
          nextCursor: page.nextCursor ?? undefined,
        };
      },
    };
  }

  /** A new thread, or the thread `id` to continue. */
  thread(id: string = crypto.randomUUID()): Thread {
    const commits = new AomiCommits(this.client, this.commits);
    return new Thread(
      id,
      (text, threadId) => this.run(text, { sessionId: threadId }),
      (ref) => commits.get(ref),
      this.raw,
    );
  }

  run(prompt: string, options?: AgentRunOptions): AgentRun {
    const normalized = prompt.trim();
    if (!normalized) throw new TypeError("prompt is required");
    return new AgentRun(
      this.client,
      normalized,
      options?.actions ?? this.actions,
      {
        ...options,
        userState: options?.userState ?? this.defaultUserState(),
        commits: options?.commits ?? this.commits,
      },
    );
  }

  /** Rehydrate an existing Agent thread; the caller owns the returned session. */
  async openSession(
    sessionId: string,
    options: Omit<AgentRunOptions, "sessionId"> = {},
  ): Promise<ClientSession> {
    if (!sessionId.trim()) throw new TypeError("sessionId is required");
    const userState = options.userState ?? this.defaultUserState();
    const session = new ClientSession(this.client, {
      ...options,
      sessionId,
      actions: options.actions ?? this.actions,
      commits: options.commits ?? this.commits,
      getUserState: () => userState,
    });
    try {
      await session.fetchCurrentState();
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }
}
