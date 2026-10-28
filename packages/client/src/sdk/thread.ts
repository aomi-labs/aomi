import type { Event, Session } from "../agent/types";
import type { AgentSessionsTransport } from "../agent/transport";
import { isTerminalCommit } from "../commits";
import type { AgentRun } from "./agent";
import type { CommitHandle } from "./commits";

/** One tool call of a turn, as the wire reports it. */
export type ToolStep = {
  /** The tool call id. */
  id: string;
  name: string;
  args?: unknown;
  /** Parsed JSON when the tool answered JSON, its text otherwise. */
  result?: unknown;
};

/**
 * Turns a raw step into what a reader shows (title, chips, status). Wire it to
 * `decode` from `@aomi-labs/client/trace`. `earlier` holds the turn's previous
 * steps, for steps that refer back to them.
 */
export type StepDecoder<T> = (
  step: ToolStep,
  earlier: readonly ToolStep[],
) => T;

export type TurnResult = {
  /** The agent's last answer. */
  reply: string;
  /** What the turn left to sign or approve, one per operation. */
  commits: CommitHandle[];
  threadId: string;
  title?: string;
};

/** A thread as the thread list shows it. */
export type ThreadSummary = Session;

/**
 * One message and the agent's work on it. Await it for the reply and commits,
 * or iterate `steps()` while it runs.
 */
export class Turn implements PromiseLike<TurnResult> {
  private readonly result: Promise<TurnResult>;
  private finished = false;

  constructor(
    private readonly run: AgentRun,
    open: (ref: string) => Promise<CommitHandle>,
  ) {
    this.result = run.result().then(async (done) => ({
      reply: done.reply,
      threadId: done.threadId,
      title: done.title,
      commits: await Promise.all(
        done.commits
          .filter((view) => !isTerminalCommit(view) && !view.batch?.index)
          .map((view) => open(view.commit_id)),
      ),
    }));
    const finish = () => {
      this.finished = true;
    };
    this.result.then(finish, finish);
  }

  then<TResult1 = TurnResult, TResult2 = never>(
    onfulfilled?:
      | ((value: TurnResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.result.then(onfulfilled, onrejected);
  }

  /** Stop the turn. Nothing to do once it is over. */
  interrupt(): Promise<void> {
    return this.finished ? Promise.resolve() : this.run.interrupt();
  }

  /** Each tool call once it has a result, in order. */
  steps(): AsyncIterable<ToolStep>;
  steps<T>(options: { decode: StepDecoder<T> }): AsyncIterable<T>;
  async *steps<T>(options?: {
    decode?: StepDecoder<T>;
  }): AsyncIterable<ToolStep | T> {
    const session = this.run.session;
    const earlier: ToolStep[] = [];
    for (;;) {
      const over = this.finished;
      const changed = new Promise<void>((resolve) => {
        const off = session.subscribe(() => {
          off();
          resolve();
        });
        this.result.then(
          () => resolve(),
          () => resolve(),
        );
      });
      const snapshot = session.getSnapshot();
      for (const step of toolSteps(snapshot.events, snapshot.turnId).slice(
        earlier.length,
      )) {
        yield options?.decode ? options.decode(step, earlier) : step;
        earlier.push(step);
      }
      if (over) return;
      await changed;
    }
  }
}

/** A conversation with the agent. */
export class Thread {
  constructor(
    readonly id: string,
    private readonly start: (text: string, threadId: string) => AgentRun,
    private readonly open: (ref: string) => Promise<CommitHandle>,
    private readonly sessions: AgentSessionsTransport,
  ) {}

  send(text: string): Turn {
    return new Turn(this.start(text, this.id), this.open);
  }

  rename(title: string): Promise<ThreadSummary> {
    return this.sessions.update(this.id, { title });
  }
}

/** A turn's tool calls, merging inline results and typed completions by call id. */
function toolSteps(events: readonly Event[], turnId?: string): ToolStep[] {
  const steps = new Map<string, ToolStep>();
  for (const event of events) {
    if (!turnId || event.turn_id !== turnId) continue;
    let step: ToolStep | undefined;
    if (event.type === "tool_complete" && event.tool_name !== "task") {
      const id = event.call_id ?? event.id;
      step = { id, name: event.tool_name, result: event.result };
    } else if (event.type === "message" && Array.isArray(event.tool_result)) {
      const [topic, payload] = event.tool_result;
      const id = event.tool_call_id ?? `inline:${event.event_id}`;
      step = {
        id,
        name: event.tool_name || topic,
        args: event.tool_arguments,
        result: parsed(payload),
      };
    }
    if (step) steps.set(step.id, { ...steps.get(step.id), ...step });
  }
  return [...steps.values()];
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
