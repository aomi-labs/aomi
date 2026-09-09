import type { AomiHttpMethod, AomiRequestOptions } from "../types";
import type {
  Action,
  ActionResult,
  ErrorBody,
  EventPage,
  Session,
  SessionPage,
  StartTurnIntent,
  AomiInferenceFundingSource,
} from "./types";

type RequestResponse = (
  method: AomiHttpMethod,
  path: string,
  options?: AomiRequestOptions,
) => Promise<Response>;

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

export class AgentTransport {
  readonly sessions: AgentSessionsTransport;

  constructor(
    private readonly requestResponse: RequestResponse,
    private readonly defaultInferenceFunding?: AomiInferenceFundingSource,
  ) {
    this.sessions = new AgentSessionsTransport(requestResponse);
  }

  start(
    intent: StartTurnIntent,
    options: {
      idempotencyKey?: string;
      paymentSignature?: string;
      inferenceFunding?: AomiInferenceFundingSource;
    } = {},
  ): Promise<EventPage> {
    const sessionId = intent.sessionId;
    return this.json("POST", "/v1/agent/chat", {
      headers: {
        ...mutationHeaders({
          ...options,
          inferenceFunding:
            options.inferenceFunding ?? this.defaultInferenceFunding,
        }),
        ...threadHeaders(sessionId),
      },
      body: intent,
    });
  }

  poll(
    sessionId: string,
    options: { cursor?: string; waitMs?: number } = {},
  ): Promise<EventPage> {
    return this.json("GET", `/v1/agent/chat/${encodeURIComponent(sessionId)}`, {
      headers: threadHeaders(sessionId),
      query: {
        cursor: options.cursor,
        wait: Math.min(Math.max(options.waitMs ?? 0, 0), 30_000),
      },
    });
  }

  interrupt(
    sessionId: string,
    turnId: string,
    idempotencyKey = randomIdempotencyKey(),
  ): Promise<EventPage> {
    return this.json(
      "POST",
      `/v1/agent/chat/${encodeURIComponent(sessionId)}/interrupt`,
      {
        headers: {
          "idempotency-key": idempotencyKey,
          ...threadHeaders(sessionId),
        },
        body: { turnId },
      },
    );
  }

  async respondToAction(
    sessionId: string,
    actionId: string,
    revision: number,
    result: ActionResult,
    idempotencyKey = randomIdempotencyKey(),
  ): Promise<Action> {
    const response = await this.json<{ action: Action }>(
      "POST",
      `/v1/agent/chat/${encodeURIComponent(sessionId)}/actions/${encodeURIComponent(actionId)}/result`,
      {
        headers: {
          "idempotency-key": idempotencyKey,
          ...threadHeaders(sessionId),
        },
        body: { revision, result },
      },
    );
    return response.action;
  }

  private async json<T>(
    method: AomiHttpMethod,
    path: string,
    options?: AomiRequestOptions,
  ): Promise<T> {
    return parseAgentResponse<T>(
      await this.requestResponse(method, path, options),
    );
  }
}

export class AgentSessionsTransport {
  constructor(private readonly requestResponse: RequestResponse) {}

  list(options: { cursor?: string; limit?: number } = {}): Promise<SessionPage> {
    return this.json("GET", "/v1/agent/sessions", {
      query: { cursor: options.cursor, limit: options.limit },
    });
  }

  async all(): Promise<Session[]> {
    const sessions: Session[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list({ cursor, limit: 100 });
      sessions.push(...page.sessions);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return sessions;
  }

  get(sessionId: string): Promise<Session> {
    return this.json("GET", `/v1/agent/sessions/${encodeURIComponent(sessionId)}`);
  }

  update(
    sessionId: string,
    patch: { title?: string; archived?: boolean },
  ): Promise<Session> {
    return this.json("PATCH", `/v1/agent/sessions/${encodeURIComponent(sessionId)}`, {
      headers: mutationHeaders(),
      body: patch,
    });
  }

  async delete(sessionId: string): Promise<void> {
    await parseAgentResponse(
      await this.requestResponse(
        "DELETE",
        `/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
        { headers: mutationHeaders() },
      ),
    );
  }

  private async json<T>(
    method: AomiHttpMethod,
    path: string,
    options?: AomiRequestOptions,
  ): Promise<T> {
    return parseAgentResponse<T>(await this.requestResponse(method, path, options));
  }
}

function mutationHeaders(
  options: {
    idempotencyKey?: string;
    paymentSignature?: string;
    inferenceFunding?: AomiInferenceFundingSource;
  } = {},
): Record<string, string> {
  return {
    "idempotency-key": options.idempotencyKey ?? randomIdempotencyKey(),
    ...(options.paymentSignature
      ? { "payment-signature": options.paymentSignature }
      : {}),
    ...(options.inferenceFunding
      ? { "x-aomi-inference-funding": options.inferenceFunding }
      : {}),
  };
}

function threadHeaders(
  sessionId: string | null | undefined,
): Record<string, string> {
  return sessionId
    ? { "x-session-id": sessionId, "x-thread-id": sessionId }
    : {};
}

function randomIdempotencyKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `agent_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

async function parseAgentResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
  let body: ErrorBody | undefined;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // The status remains authoritative when an intermediary returned HTML.
  }
  const raw = body?.error;
  const code =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" && raw !== null && "code" in raw
        ? String((raw as { code: unknown }).code)
        : "agent_request_failed";
  throw new AgentApiError(
    response.status,
    code,
    code.replaceAll("_", " "),
    response.status === 408 || response.status === 429 || response.status >= 500,
    response.headers.get("x-request-id") ?? undefined,
    raw,
  );
}
