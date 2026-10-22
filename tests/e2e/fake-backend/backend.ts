// In-memory stand-in for the agent backend's /v1/agent/* surface. It is
// transport-agnostic: `handle` takes a plain request and returns a plain
// response, so the same state machine serves Playwright route mocks
// (./playwright.ts) and the standalone HTTP server (./server.ts).
//
// It never fakes auth. Requests are accepted whatever identity they carry;
// the identity headers are only recorded so a spec can assert on them.
import {
  encodeFrame,
  type ErrorBody,
  type Event,
  type EventBody,
  type EventPage,
  type InputReceipt,
  type Session,
  type StartTurnIntent,
  type StreamFrame,
} from "./protocol";
import {
  editedReplyText,
  paymentChallenge,
  replyText,
  rerunReplyText,
  scenarioFor,
  turnBody,
} from "./scenarios";

export type FakeRequest = {
  method: string;
  url: URL;
  headers: Record<string, string | undefined>;
  body?: unknown;
};

export type FakeResponse =
  | {
      kind: "json";
      status: number;
      headers?: Record<string, string>;
      body: unknown;
    }
  | { kind: "stream"; sessionId: string; cursor: number };

export type LoggedRequest = {
  at: number;
  method: string;
  path: string;
  origin: string;
  route: RouteName;
  sessionId?: string;
};

export type RouteName =
  | "sessions.list"
  | "sessions.get"
  | "sessions.update"
  | "sessions.delete"
  | "chat.start"
  | "chat.steer"
  | "chat.poll"
  | "chat.stream"
  | "chat.interrupt"
  | "chat.action"
  | "unknown";

type Thread = {
  session: Session;
  events: Event[];
  activeTurn: string | null;
  lastPrompt: string;
  inputRevision: number;
  appliedRevision: number;
  queued: Array<{ receipt: InputReceipt; message: string }>;
};

export type SeedThread = {
  id: string;
  title: string;
  /** Alternating user/agent messages, user first. */
  messages: string[];
  updatedAt?: number;
  archived?: boolean;
};

const AGENT_PATH = /^\/v1\/agent(?:\/|$)/;

export function isAgentPath(pathname: string): boolean {
  return AGENT_PATH.test(pathname);
}

export class FakeAgentBackend {
  readonly log: LoggedRequest[] = [];
  private turnInputEnabled = false;
  private finishSteerRace = false;
  private readonly pendingInputs = new Map<
    string,
    Array<{ receipt: InputReceipt; message: string }>
  >();
  private readonly turnInputRequests = new Map<
    string,
    { hash: string; response: FakeResponse }
  >();
  private readonly threads = new Map<string, Thread>();
  private readonly subscribers = new Map<
    string,
    Set<(chunk: string) => void>
  >();
  private readonly idempotent = new Map<string, FakeResponse>();
  constructor(
    private readonly options: {
      reply?: (message: string) => string;
      scenario?: typeof scenarioFor;
      transactionFrom?: string;
      transactionText?: string;
      title?: typeof titleFor;
    } = {},
  ) {}

  private readonly actionResults = new Map<string, FakeResponse>();
  private sequence = 0;
  private turn = 0;

  // ---- spec-facing API -------------------------------------------------

  hasSession(id: string): boolean {
    return this.threads.has(id);
  }

  reset(): void {
    this.log.length = 0;
    this.threads.clear();
    this.idempotent.clear();
    this.actionResults.clear();
    this.pendingInputs.clear();
    this.turnInputRequests.clear();
    this.startIntents.length = 0;
    this.sequence = 0;
    this.turn = 0;
  }

  /** Append delayed events to the admitted turn. Poll and SSE use one ledger. */
  appendTurnEvents(sessionId: string, bodies: readonly EventBody[]): EventPage {
    const thread = this.threads.get(sessionId);
    if (!thread?.activeTurn) throw new Error("No active fixture turn");
    const cursor = this.sequence;
    for (const body of bodies) {
      thread.events.push(this.envelope(thread.activeTurn, body));
      if (
        body.type === "turn_state_changed" &&
        ["complete", "failed", "interrupted"].includes(body.state)
      ) {
        thread.activeTurn = null;
        break;
      }
    }
    const page = this.page(thread, cursor);
    this.publish(sessionId, { event: "page", data: page });
    return page;
  }

  seed(thread: SeedThread): void {
    const t = this.thread(thread.id, true);
    t.session = {
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt ?? Date.now(),
      archived: thread.archived ?? false,
    };
    thread.messages.forEach((content, index) => {
      const turnId = `seed-${thread.id}-${Math.floor(index / 2)}`;
      t.events.push(
        this.envelope(turnId, {
          type: "message",
          sender: index % 2 === 0 ? "user" : "agent",
          content,
          message_key: `${thread.id}-m${index}`,
        }),
      );
      if (index % 2 === 1)
        t.events.push(
          this.envelope(turnId, {
            type: "turn_state_changed",
            state: "complete",
          }),
        );
    });
  }

  /** Opt in per journey; legacy transport fixtures keep their original wire. */
  enableTurnInput(): void {
    this.turnInputEnabled = true;
  }

  /** Race hook: finish after the composer chose a target, before admission. */
  finishBeforeNextSteer(): void {
    this.finishSteerRace = true;
  }

  applySteering(sessionId: string): void {
    const thread = this.thread(sessionId, false);
    const pending = this.pendingInputs.get(sessionId) ?? [];
    const before = this.sequence;
    for (const { receipt, message } of pending) {
      const applied = {
        ...receipt,
        disposition: "applied" as const,
        applied_at: 2,
      };
      thread.events.push(
        this.envelope(receipt.turn_id, {
          type: "turn_input",
          ...applied,
          message,
        }),
        this.envelope(receipt.turn_id, {
          type: "message",
          sender: "user",
          content: message,
          message_key: receipt.input_id,
          input_id: receipt.input_id,
          input_revision: receipt.input_revision,
        }),
      );
      thread.appliedRevision = receipt.input_revision;
    }
    this.pendingInputs.delete(sessionId);
    this.publish(sessionId, { event: "page", data: this.page(thread, before) });
  }

  completeActiveInput(sessionId: string, answer: string): void {
    const thread = this.thread(sessionId, false);
    if (!thread.activeTurn) throw new Error("No active fixture input");
    this.applySteering(sessionId);
    const before = this.sequence;
    const turn = thread.activeTurn;
    thread.events.push(
      this.envelope(turn, {
        type: "message",
        sender: "agent",
        content: answer,
        message_key: `${turn}:answer`,
        input_revision: thread.inputRevision,
      }),
      this.envelope(turn, { type: "turn_state_changed", state: "complete" }),
    );
    thread.activeTurn = null;
    thread.inputRevision = 0;
    thread.appliedRevision = 0;
    const next = thread.queued.shift();
    if (next) {
      thread.activeTurn = next.receipt.turn_id;
      thread.inputRevision = thread.appliedRevision = 1;
      thread.events.push(
        this.envelope(next.receipt.turn_id, {
          type: "turn_input",
          ...next.receipt,
          disposition: "applied",
          applied_at: 2,
          message: next.message,
        }),
        this.envelope(next.receipt.turn_id, {
          type: "message",
          sender: "user",
          content: next.message,
          message_key: next.receipt.input_id,
          input_id: next.receipt.input_id,
          input_revision: 1,
        }),
        this.envelope(next.receipt.turn_id, {
          type: "turn_state_changed",
          state: "processing",
        }),
      );
    }
    this.publish(sessionId, { event: "page", data: this.page(thread, before) });
  }

  private sharedInput(request: FakeRequest, steering: boolean): FakeResponse {
    const key = request.headers["idempotency-key"];
    const body = request.body as StartTurnIntent & {
      turnId?: string;
      expectedInputRevision?: number;
    };
    const hash = JSON.stringify({ path: request.url.pathname, body });
    const replay = key ? this.turnInputRequests.get(key) : undefined;
    if (replay)
      return replay.hash === hash
        ? replay.response
        : json(409, error("idempotency_conflict", "Input identity was reused"));
    const sessionId = steering
      ? segment(request.url.pathname, 4)
      : (body.sessionId ?? "shared-input-session");
    const thread = this.thread(sessionId, true);
    if (steering && this.finishSteerRace) {
      this.finishSteerRace = false;
      this.completeActiveInput(sessionId, "Finished before your update");
    }
    if (steering && (!thread.activeTurn || body.turnId !== thread.activeTurn))
      return json(
        409,
        error(
          "target_terminal",
          "This request finished. Send your text as a new request.",
        ),
      );
    if (steering && body.expectedInputRevision !== thread.inputRevision)
      return json(
        409,
        error("input_revision_conflict", "Another update changed this request"),
      );
    const queued =
      !steering && body.intent === "queue" && thread.activeTurn !== null;
    if (!steering && !queued && thread.activeTurn)
      return json(409, error("thread_busy", "An input is already active"));
    const before = this.sequence;
    const turn = steering ? thread.activeTurn! : `turn-${++this.turn}`;
    const receipt: InputReceipt = {
      input_id: key ?? `input-${this.turn}-${this.sequence}`,
      turn_id: turn,
      operation: steering
        ? "steer"
        : body.intent === "queue"
          ? "queue"
          : "start",
      disposition: steering ? "accepted" : queued ? "queued" : "applied",
      input_revision: steering ? thread.inputRevision + 1 : 1,
      received_at: 1,
      admitted_at: 1,
      applied_at: !steering && !queued ? 1 : null,
    };
    const message = body.message ?? "";
    thread.events.push(
      this.envelope(turn, { type: "turn_input", ...receipt, message }),
    );
    if (steering) {
      thread.inputRevision = receipt.input_revision;
      const pending = this.pendingInputs.get(sessionId) ?? [];
      pending.push({ receipt, message });
      this.pendingInputs.set(sessionId, pending);
      // A pending approval belongs to the previous input revision.
      for (const action of thread.events.filter(
        (event) => event.type === "action" && event.state === "pending",
      )) {
        if (action.type === "action")
          thread.events.push(
            this.envelope(turn, {
              ...action,
              revision: action.revision + 1,
              state: "superseded",
            } as EventBody),
          );
      }
    } else if (queued) {
      thread.queued.push({ receipt, message });
      this.startIntents.push(body);
    } else {
      thread.activeTurn = turn;
      thread.inputRevision = thread.appliedRevision = 1;
      thread.lastPrompt = message;
      this.startIntents.push(body);
      thread.events.push(
        this.envelope(turn, {
          type: "message",
          sender: "user",
          content: message,
          message_key: receipt.input_id,
          input_id: receipt.input_id,
          input_revision: 1,
        }),
      );
      const result = turnBody(
        (this.options.scenario ?? scenarioFor)(message),
        message,
        this.turn,
        (this.options.reply ?? replyText)(message),
        this.options.transactionFrom,
        this.options.transactionText,
      );
      thread.events.push(
        ...result.events.map((event) =>
          this.envelope(
            turn,
            event.type === "message" ? { ...event, input_revision: 1 } : event,
          ),
        ),
      );
      if (result.terminal === "complete") {
        thread.events.push(
          this.envelope(turn, {
            type: "turn_state_changed",
            state: "complete",
          }),
        );
        thread.activeTurn = null;
        thread.inputRevision = thread.appliedRevision = 0;
      }
    }
    const page = {
      ...this.page(thread, before),
      input: receipt,
      ...(!steering ? { started_turn_id: turn } : {}),
    };
    const response = json(200, page);
    if (key) this.turnInputRequests.set(key, { hash, response });
    this.publish(sessionId, { event: "page", data: page });
    return response;
  }

  /** Index into `log`; pass to `requestsSince` to scope an assertion. */
  mark(): number {
    return this.log.length;
  }

  requestsSince(mark: number, route?: RouteName): LoggedRequest[] {
    return this.log
      .slice(mark)
      .filter((entry) => route === undefined || entry.route === route);
  }

  sessions(): Session[] {
    return [...this.threads.values()].map((t) => t.session);
  }

  starts(): StartTurnIntent[] {
    return this.startIntents.slice();
  }

  /** A detached ledger snapshot for durability checks across browser reloads. */
  events(sessionId: string): Event[] {
    return structuredClone(this.threads.get(sessionId)?.events ?? []);
  }

  private readonly startIntents: StartTurnIntent[] = [];

  // ---- protocol --------------------------------------------------------

  async handle(request: FakeRequest): Promise<FakeResponse> {
    const path = request.url.pathname;
    const route = routeOf(request.method, path);
    const sessionId =
      request.headers["x-session-id"] ??
      decodeURIComponent(path.split("/")[4] ?? "") ??
      undefined;
    this.log.push({
      at: Date.now(),
      method: request.method,
      path,
      origin: request.url.origin,
      route,
      sessionId: sessionId || undefined,
    });
    switch (route) {
      case "sessions.list":
        return json(200, {
          sessions: this.sessions()
            .filter((s) => this.threads.get(s.id)!.events.length > 0)
            .sort((a, b) => b.updatedAt - a.updatedAt),
          nextCursor: null,
        });
      case "sessions.get": {
        const t = this.threads.get(segment(path, 4));
        return t ? json(200, t.session) : notFound();
      }
      case "sessions.update": {
        const t = this.threads.get(segment(path, 4));
        if (!t) return notFound();
        const patch = (request.body ?? {}) as {
          title?: string;
          archived?: boolean;
        };
        t.session = {
          ...t.session,
          ...(patch.title != null ? { title: patch.title } : {}),
          ...(patch.archived != null ? { archived: patch.archived } : {}),
          updatedAt: Date.now(),
        };
        return json(200, t.session);
      }
      case "sessions.delete":
        this.threads.delete(segment(path, 4));
        return { kind: "json", status: 204, body: null };
      case "chat.start":
        return this.turnInputEnabled
          ? this.sharedInput(request, false)
          : this.start(request);
      case "chat.steer":
        return this.turnInputEnabled
          ? this.sharedInput(request, true)
          : notFound();
      case "chat.poll": {
        const t = this.thread(segment(path, 4), false);
        const cursor = Number(request.url.searchParams.get("cursor") ?? 0);
        return json(200, this.page(t, cursor));
      }
      case "chat.stream":
        return {
          kind: "stream",
          sessionId: segment(path, 4),
          cursor: Number(request.url.searchParams.get("cursor") ?? 0),
        };
      case "chat.interrupt":
        return this.interrupt(
          segment(path, 4),
          request.body as { turnId?: string },
        );
      case "chat.action":
        return this.actionResult(
          segment(path, 4),
          segment(path, 6),
          request.body as { revision?: number; result?: { status?: string } },
          request.headers["idempotency-key"],
        );
      default:
        return json(
          404,
          error("not_found", `No fake route for ${request.method} ${path}`),
        );
    }
  }

  /** Initial SSE body for a new stream subscriber; later frames are pushed. */
  openStream(
    sessionId: string,
    cursor: number,
    write: (chunk: string) => void,
  ): () => void {
    const t = this.thread(sessionId, false);
    write(": fake stream connected\n\n");
    write(encodeFrame({ event: "page", data: this.page(t, cursor) }));
    const set = this.subscribers.get(sessionId) ?? new Set();
    set.add(write);
    this.subscribers.set(sessionId, set);
    return () => set.delete(write);
  }

  // ---- internals -------------------------------------------------------

  private start(request: FakeRequest): FakeResponse {
    const key = request.headers["idempotency-key"];
    if (key && this.idempotent.has(key)) return this.idempotent.get(key)!;
    const intent = request.body as StartTurnIntent;
    const message = intent.message ?? "";
    const scenario = (this.options.scenario ?? scenarioFor)(message);
    const paid =
      request.headers["payment-signature"] ?? request.headers["x-payment"];
    if (scenario === "pay" && !paid) {
      const challenge = paymentChallenge(request.url.toString());
      return {
        kind: "json",
        status: 402,
        headers: {
          "payment-required": Buffer.from(JSON.stringify(challenge)).toString(
            "base64",
          ),
        },
        body: challenge,
      };
    }
    this.startIntents.push(intent);
    const sessionId = intent.sessionId ?? `fake-session-${this.turn + 1}`;
    const t = this.thread(sessionId, true);
    const turnId = `turn-${++this.turn}`;
    const before = this.sequence;
    const target = intent.edit ?? intent.regenerate ?? null;
    let answer = (this.options.reply ?? replyText)(message);
    if (target) {
      const selected = t.events.find(
        (e) => e.type === "message" && e.message_key === target,
      );
      const user = intent.edit
        ? selected
        : t.events
            .slice(0, selected ? t.events.indexOf(selected) : 0)
            .findLast((e) => e.type === "message" && e.sender === "user");
      const removed = user ? t.events.slice(t.events.indexOf(user)) : [];
      const isRerun =
        Boolean(intent.regenerate) ||
        (user?.type === "message" && user.content === message);
      answer = isRerun ? rerunReplyText(message) : editedReplyText(message);
      t.events.push(
        this.envelope(turnId, {
          type: "branch",
          kind: intent.edit ? "edit" : "regenerate",
          target_message_key: target,
          user_message_key:
            user?.type === "message" ? (user.message_key ?? target) : target,
          content: message,
          removed_message_keys: removed.flatMap((e) =>
            e.type === "message" && e.message_key ? [e.message_key] : [],
          ),
          removed_turn_ids: [
            ...new Set(removed.flatMap((e) => (e.turn_id ? [e.turn_id] : []))),
          ],
        }),
      );
    }
    t.lastPrompt = message;
    t.events.push(
      this.envelope(turnId, {
        type: "message",
        sender: "user",
        content: message,
        message_key: `user-${this.turn}`,
      }),
    );
    const body = turnBody(
      scenario,
      message,
      this.turn,
      answer,
      this.options.transactionFrom,
      this.options.transactionText,
    );
    for (const event of body.events)
      t.events.push(this.envelope(turnId, event));
    if (body.terminal === "complete")
      t.events.push(
        this.envelope(turnId, {
          type: "turn_state_changed",
          state: "complete",
        }),
      );
    t.activeTurn = body.terminal === "complete" ? null : turnId;
    if (!t.session.title) {
      t.session.title = (this.options.title ?? titleFor)(message);
      t.events.push(
        this.envelope(turnId, {
          type: "title_changed",
          title: t.session.title,
        }),
      );
    }
    t.session.updatedAt = Date.now();
    const page = { ...this.page(t, before), started_turn_id: turnId };
    this.publish(sessionId, { event: "page", data: page });
    const response = json(200, page);
    if (key) this.idempotent.set(key, response);
    return response;
  }

  private interrupt(
    sessionId: string,
    intent: { turnId?: string },
  ): FakeResponse {
    const t = this.thread(sessionId, false);
    const turnId = intent?.turnId ?? t.activeTurn;
    if (!turnId || t.activeTurn !== turnId)
      return json(200, {
        ...this.page(t, this.sequence),
        ...(turnId
          ? { terminal_turn: { turn_id: turnId, state: "complete" } }
          : {}),
      });
    const before = this.sequence;
    t.events.push(
      this.envelope(turnId, {
        type: "turn_state_changed",
        state: "interrupted",
      }),
    );
    t.activeTurn = null;
    const page: EventPage = {
      ...this.page(t, before),
      stopped_turn_id: turnId,
      terminal_turn: { turn_id: turnId, state: "interrupted" },
    };
    this.publish(sessionId, { event: "page", data: page });
    return json(200, page);
  }

  private actionResult(
    sessionId: string,
    actionId: string,
    body: { revision?: number; result?: { status?: string } },
    idempotencyKey?: string,
  ): FakeResponse {
    const key = idempotencyKey
      ? `${sessionId}:${actionId}:${idempotencyKey}`
      : undefined;
    if (key && this.actionResults.has(key)) return this.actionResults.get(key)!;
    const t = this.thread(sessionId, false);
    const action = t.events.findLast(
      (e) => e.type === "action" && e.id === actionId,
    );
    if (!action || action.type !== "action") return notFound();
    if (body?.revision !== action.revision || action.state !== "pending")
      return json(
        409,
        error("stale_action_revision", "Action has already changed"),
      );
    const before = this.sequence;
    const rejected = body?.result?.status === "rejected";
    const turnId = action.turn_id ?? `turn-${this.turn}`;
    const updated = this.envelope(turnId, {
      ...action,
      revision: action.revision + 1,
      state: rejected ? "rejected" : "submitted",
      result: (body?.result ?? null) as never,
    } as EventBody);
    t.events.push(
      updated,
      this.envelope(turnId, {
        type: "message",
        sender: "agent",
        content: rejected
          ? "Fake: transfer rejected."
          : "Fake: transfer submitted.",
        message_key: `action-reply-${actionId}-${updated.sequence}`,
      }),
      this.envelope(turnId, { type: "turn_state_changed", state: "complete" }),
    );
    t.activeTurn = null;
    this.publish(sessionId, { event: "page", data: this.page(t, before) });
    const response = json(200, { action: updated });
    if (key) this.actionResults.set(key, response);
    return response;
  }

  private publish(sessionId: string, frame: StreamFrame): void {
    for (const write of this.subscribers.get(sessionId) ?? [])
      write(encodeFrame(frame));
  }

  private page(t: Thread, cursor: number): EventPage {
    return {
      session_id: t.session.id,
      cursor: String(t.events.at(-1)?.sequence ?? cursor),
      events: t.events.filter((e) => e.sequence > cursor),
      has_more: false,
      ...(this.turnInputEnabled
        ? {
            capabilities: { turn_input: 1 },
            control: {
              active_turn_id: t.activeTurn,
              accepted_input_revision: t.inputRevision,
              applied_input_revision: t.appliedRevision,
              queued_turn_ids: t.queued.map((input) => input.receipt.turn_id),
              event_sequence: this.sequence,
              stream_epoch: "fixture-input-epoch",
            },
          }
        : {}),
    };
  }

  private thread(id: string, create: boolean): Thread {
    let t = this.threads.get(id);
    if (!t) {
      t = {
        session: { id, title: null, updatedAt: Date.now(), archived: false },
        events: [],
        activeTurn: null,
        lastPrompt: "",
        inputRevision: 0,
        appliedRevision: 0,
        queued: [],
      };
      // Unknown sessions read as empty (new chat) without being listed.
      if (create || id) this.threads.set(id, t);
    }
    return t;
  }

  private envelope(turnId: string, body: EventBody): Event {
    return {
      ...body,
      event_id: `fake-event-${++this.sequence}`,
      sequence: this.sequence,
      turn_id: turnId,
      occurred_at: Date.now() / 1000,
    } as Event;
  }
}

export function titleFor(message: string): string {
  return `Title: ${message.slice(0, 24)}`;
}

function routeOf(method: string, path: string): RouteName {
  if (path === "/v1/agent/sessions" && method === "GET") return "sessions.list";
  if (/^\/v1\/agent\/sessions\/[^/]+$/.test(path))
    return method === "GET"
      ? "sessions.get"
      : method === "PATCH"
        ? "sessions.update"
        : method === "DELETE"
          ? "sessions.delete"
          : "unknown";
  if (path === "/v1/agent/chat" && method === "POST") return "chat.start";
  if (/^\/v1\/agent\/chat\/[^/]+$/.test(path) && method === "GET")
    return "chat.poll";
  if (/^\/v1\/agent\/chat\/[^/]+\/steer$/.test(path) && method === "POST")
    return "chat.steer";
  if (/^\/v1\/agent\/chat\/[^/]+\/stream$/.test(path)) return "chat.stream";
  if (/^\/v1\/agent\/chat\/[^/]+\/interrupt$/.test(path))
    return "chat.interrupt";
  if (/^\/v1\/agent\/chat\/[^/]+\/actions\/[^/]+\/result$/.test(path))
    return "chat.action";
  return "unknown";
}

function segment(path: string, index: number): string {
  return decodeURIComponent(path.split("/")[index] ?? "");
}

function json(status: number, body: unknown): FakeResponse {
  return { kind: "json", status, body };
}

function error(code: string, message: string): ErrorBody {
  return { error: { code, message, retryable: false } };
}

function notFound(): FakeResponse {
  return json(404, error("session_not_found", "Unknown fake session"));
}
