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
        return this.start(request);
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
