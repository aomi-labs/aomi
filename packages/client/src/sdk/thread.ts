import type { ErrorEvent, Event, Session } from "../agent/types";
import { AomiError } from "../api-error";
import type { AgentTransport } from "../agent/transport";
import type { AomiActiveWallet } from "../account/wallets";
import type { ToolStepInput } from "../trace/types";
import { isTerminalCommit } from "../commits";
import type { AgentRun, AgentRunOptions } from "./agent";
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
 * Turns a step into what a reader shows (title, chips, outcome): `decode`
 * from `@aomi-labs/client/trace`.
 */
export type StepDecoder<T> = (input: ToolStepInput) => T;

export type TurnResult = {
  /**
   * `completed`; `interrupted`; or `awaiting_approval`: the turn handed off
   * commits to sign or approve and waits for them (the agent picks up once
   * they settle). A failed turn rejects with an AomiError (`turn_failed`).
   */
  state: "completed" | "interrupted" | "awaiting_approval";
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
 * or iterate `steps()` while it runs. It settles when the turn ends or hands
 * off commits (`state: "awaiting_approval"`); `interrupt()` still stops a
 * handed-off turn on the backend.
 */
export class Turn implements PromiseLike<TurnResult> {
  private readonly result: Promise<TurnResult>;
  private finished = false;
  private handedOff?: string;

  constructor(
    private readonly run: AgentRun,
    open: (ref: string) => Promise<CommitHandle>,
  ) {
    this.result = run.result().then(async (done) => {
      const { turnId, turnState, events } = run.session.getSnapshot();
      if (turnState === "failed")
        throw new AomiError(
          "turn_failed",
          events.findLast(
            (event): event is ErrorEvent =>
              event.type === "error" && event.turn_id === turnId,
          )?.message ?? "The turn failed",
        );
      if (turnState === "awaiting_action") this.handedOff = turnId;
      return {
        state:
          turnState === "interrupted"
            ? "interrupted"
            : turnState === "awaiting_action"
              ? "awaiting_approval"
              : "completed",
        reply: done.reply,
        threadId: done.threadId,
        title: done.title,
        commits: await Promise.all(
          done.commits
            .filter((view) => !isTerminalCommit(view) && !view.batch?.index)
            .map((view) => open(view.commit_id)),
        ),
      };
    });
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

  /** Stop the turn, also one that handed off commits and waits for them. */
  async interrupt(): Promise<void> {
    if (!this.finished) return this.run.interrupt();
    const { client, sessionId } = this.run.session;
    if (this.handedOff) await client.agent.interrupt(sessionId, this.handedOff);
  }

  /** Each tool call once it has a result, in order. */
  steps(): AsyncIterable<ToolStep>;
  steps<T>(options: { decode: StepDecoder<T> }): AsyncIterable<T>;
  async *steps<T>(options?: {
    decode?: StepDecoder<T>;
  }): AsyncIterable<ToolStep | T> {
    const session = this.run.session;
    let wake = () => {};
    const off = session.subscribe(() => wake());
    this.result.then(
      () => wake(),
      () => wake(),
    );
    // Every turn id this run has been on.
    const turns = new Set<string>();
    const earlier: ToolStep[] = [];
    try {
      for (;;) {
        const changed = new Promise<void>((resolve) => {
          wake = resolve;
        });
        const over = this.finished;
        const snapshot = session.getSnapshot();
        if (snapshot.turnId) turns.add(snapshot.turnId);
        for (const step of toolSteps(snapshot.events, turns, over).slice(
          earlier.length,
        )) {
          yield options?.decode
            ? options.decode(stepInput(step, earlier))
            : step;
          earlier.push(step);
        }
        if (over) return;
        await changed;
      }
    } finally {
      off();
    }
  }
}

/** One past turn: your message, the agent's tool calls and what it said. */
export type ThreadHistoryTurn<S = ToolStep> = {
  text: string;
  steps: S[];
  replies: string[];
  /** How long the agent worked on it, not counting waits for approval. */
  seconds: number;
};

/** What a thread said so far, and the wallet it trades with per family. */
export type ThreadHistory<S = ToolStep> = {
  messages: { sender: "user" | "agent"; text: string }[];
  turns: ThreadHistoryTurn<S>[];
  activeWallet: AomiActiveWallet;
};

/** A conversation with the agent. */
export class Thread {
  constructor(
    readonly id: string,
    private readonly start: (
      text: string,
      threadId: string,
      options?: Omit<AgentRunOptions, "sessionId">,
    ) => AgentRun,
    private readonly open: (ref: string) => Promise<CommitHandle>,
    private readonly agent: AgentTransport,
  ) {}

  /** Send `text`; `options` pick the app, model and wallet state for this turn. */
  send(text: string, options?: Omit<AgentRunOptions, "sessionId">): Turn {
    return new Turn(this.start(text, this.id, options), this.open);
  }

  rename(title: string): Promise<ThreadSummary> {
    return this.agent.sessions.update(this.id, { title });
  }

  /** The latest page of the conversation: what was said, turn by turn with its tool calls. */
  history(): Promise<ThreadHistory>;
  history<T>(options: { decode: StepDecoder<T> }): Promise<ThreadHistory<T>>;
  async history(options?: {
    decode?: StepDecoder<unknown>;
  }): Promise<ThreadHistory<unknown>> {
    const page = await this.agent.poll(this.id);
    const said = (event: Event) =>
      event.type === "message" &&
      (event.sender === "user" || event.sender === "agent") &&
      !event.tool_call_id &&
      event.content.trim()
        ? { sender: event.sender, text: event.content }
        : undefined;
    const messages = page.events.flatMap((event) => said(event) ?? []);
    // A turn runs from one of your messages to the next.
    const starts = page.events.flatMap((event, at) =>
      event.type === "message" && event.sender === "user" ? [at] : [],
    );
    const turns = starts.map((start, index) => {
      const events = page.events.slice(start, starts[index + 1]);
      const own = events.filter(
        (event) => event.turn_id && event.turn_id === events[0]!.turn_id,
      );
      const steps = toolSteps(events, new Set(), true);
      const decode = options?.decode;
      return {
        text: (events[0] as Event & { content: string }).content,
        steps: decode
          ? steps.map((step, at) => decode(stepInput(step, steps.slice(0, at))))
          : steps,
        replies: events.slice(1).flatMap((event) => {
          const message = said(event);
          return message?.sender === "agent" ? [message.text] : [];
        }),
        seconds: span(own.length ? own : events),
      };
    });
    return { messages, turns, activeWallet: page.active_wallet ?? {} };
  }
}

/**
 * A turn's finished tool calls in order, from its start on (callback turns
 * that continue it included), merging inline results, typed
 * completions and the arguments the model sent, by call id. Until `over`,
 * the newest call waits for a later event, in case its arguments trail.
 */
function toolSteps(
  events: readonly Event[],
  turns: ReadonlySet<string>,
  over: boolean,
): ToolStep[] {
  const steps = new Map<string, ToolStep & { at: number }>();
  const args = new Map<string, unknown>();
  // From this run's user message (history may precede it), else from the
  // first event of a turn it has been on.
  const user = events.findLastIndex(
    (event) => event.type === "message" && event.sender === "user",
  );
  const first =
    user >= 0
      ? user
      : events.findIndex((event) => event.turn_id && turns.has(event.turn_id));
  events.forEach((event, at) => {
    if (first < 0 || at < first) return;
    if (event.type === "message" && event.tool_call_id)
      if (event.tool_arguments !== undefined)
        args.set(event.tool_call_id, event.tool_arguments);
    let step: ToolStep | undefined;
    if (event.type === "tool_complete" && event.tool_name !== "task") {
      step = {
        id: event.call_id ?? event.id,
        name: event.tool_name,
        result: event.result,
      };
    } else if (event.type === "message" && Array.isArray(event.tool_result)) {
      const [topic, payload] = event.tool_result;
      step = {
        id: event.tool_call_id ?? `inline:${event.event_id}`,
        name: event.tool_name || topic,
        result: parsed(payload),
      };
    }
    if (step) steps.set(step.id, { ...steps.get(step.id), ...step, at });
  });
  const last = events.length - 1;
  const done: ToolStep[] = [];
  for (const { at, ...step } of steps.values()) {
    if (!over && at >= last) break;
    done.push(args.has(step.id) ? { ...step, args: args.get(step.id) } : step);
  }
  return done;
}

/** What a decoder reads for `step`: the results before it give context. */
function stepInput(
  step: ToolStep,
  earlier: readonly ToolStep[],
): ToolStepInput {
  return {
    toolName: step.name,
    argsText: step.args === undefined ? undefined : JSON.stringify(step.args),
    result: step.result,
    relatedResults: earlier.map((previous) => previous.result),
  };
}

/** Seconds from the first event to the last. */
const span = (events: readonly Event[]) =>
  events.length ? events.at(-1)!.occurred_at - events[0]!.occurred_at : 0;

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
