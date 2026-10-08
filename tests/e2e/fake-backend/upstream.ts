// The agent backend as the Portal's BFF sees it: public catalogs, account
// reads and /v1/agent/*, each request checked for the bearer the BFF signs
// with the committed development key. Agent threads are kept per account so
// one account can never read another's chat.
import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { FakeAgentBackend, type FakeRequest } from "./backend";
import { readBody, sendFakeResponse } from "./server";

/** Development BFF signing key; its public half is in packages/account's topology. */
export const bffPrivateKey =
  "-----BEGIN PRIVATE KEY-----\n" +
  "MC4CAQAwBQYDK2VwBCIEIA3YGS2n6pAbisXZxFbDPdncGRxMXI2m4eJN2gNSf+wi\n" +
  "-----END PRIVATE KEY-----";
const bffPublicKey = createPublicKey(createPrivateKey(bffPrivateKey));

export type Principal = {
  sub: string;
  iss?: string;
  aud?: string | string[];
  role?: string;
  scope?: string;
  resource?: string;
  auth_source?: string;
  principal_class?: string;
  sid?: string;
  kid?: string;
};

export type UpstreamRecord = {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string | string[] | undefined>;
  authorization: "verified-bff-bearer" | "absent";
  cookie: "present" | "absent";
  principal: Principal | null;
};

export type UpstreamOptions = {
  port?: number;
  /** Address the fake wallet review asks the browser to sign from. */
  transactionFrom?: string;
};

export async function startAgentUpstream(options: UpstreamOptions = {}) {
  const records: UpstreamRecord[] = [];
  const owners = new Map<string, string>();
  const agents = new Map<string, FakeAgentBackend>();
  const streams = new Set<ServerResponse>();
  const agentFor = (owner: string) => {
    let agent = agents.get(owner);
    if (!agent) {
      agent = new FakeAgentBackend({
        reply: (message) => `Controlled reply for ${message}`,
        title: (message) => message,
        scenario: (message) =>
          message === "prepare the deterministic wallet review"
            ? "tx"
            : "reply",
        transactionFrom: options.transactionFrom,
        transactionText:
          "Review the simulated transfer before handing it to your wallet.",
      });
      agents.set(owner, agent);
    }
    return agent;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://upstream.invalid");
    const method = request.method ?? "GET";
    const record = (principal: Principal | null) =>
      records.push(recordFor(request, url, principal));

    if (url.pathname === "/__records") return json(response, 200, { records });
    if (url.pathname === "/__reset" && method === "POST") {
      records.length = 0;
      owners.clear();
      for (const agent of agents.values()) agent.reset();
      return json(response, 204);
    }

    if (url.pathname.startsWith("/api/")) {
      const accountRoute = accountResponse(method, url.pathname);
      if (!accountRoute) {
        record(null);
        const catalog = catalogResponse(url.pathname);
        return catalog
          ? json(response, 200, catalog)
          : json(response, 404, { error: "fixture_route_not_found" });
      }
      const principal = verifyBearer(request, "aomi-backend");
      record(principal);
      if (!principal)
        return json(response, 401, { error: { code: "invalid_token" } });
      if (accountRoute === "thread-safety") {
        const threadId = request.headers["x-thread-id"];
        if (
          typeof threadId !== "string" ||
          owners.get(threadId) !== principal.sub
        )
          return json(response, 404, { error: { code: "session_not_found" } });
      }
      return json(response, 200, accountBody(accountRoute, principal));
    }

    const principal = verifyBearer(request, "aomi-api-server");
    record(principal);
    if (!principal)
      return json(response, 401, { error: { code: "invalid_token" } });

    if (url.pathname === "/v1/agent/error-fixture") {
      response.setHeader("retry-after", "7");
      response.setHeader("x-request-id", "fixture-error-request");
      return json(response, 429, { error: { code: "fixture_limited" } });
    }
    if (url.pathname === "/v1/account/statement" && method === "GET")
      return json(response, 200, statement);
    if (url.pathname === "/v1/account/credits" && method === "GET")
      return json(response, 200, credits);
    if (!url.pathname.startsWith("/v1/agent/"))
      return json(response, 404, {
        error: { code: "fixture_route_not_found" },
      });

    const agent = agentFor(principal.sub);
    const text = await readBody(request);
    const body = text ? JSON.parse(text) : undefined;
    const sessionId =
      url.pathname === "/v1/agent/chat" && method === "POST"
        ? body?.sessionId
        : decodeURIComponent(
            /^\/v1\/agent\/(?:chat|sessions)\/([^/]+)/.exec(
              url.pathname,
            )?.[1] ?? "",
          ) || undefined;
    if (
      sessionId &&
      owners.has(sessionId) &&
      owners.get(sessionId) !== principal.sub
    )
      return json(response, 404, { error: { code: "session_not_found" } });
    if (method === "POST" && url.pathname === "/v1/agent/chat") {
      if (typeof sessionId !== "string" || typeof body?.message !== "string")
        return json(response, 400, { error: { code: "invalid_request" } });
      owners.set(sessionId, principal.sub);
    } else if (sessionId && !agent.hasSession(sessionId)) {
      return json(response, 404, { error: { code: "session_not_found" } });
    }
    const fakeRequest: FakeRequest = {
      method,
      url,
      headers: flatHeaders(request),
      body,
    };
    sendFakeResponse(agent, await agent.handle(fakeRequest), response, streams);
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error("fake upstream error:", error);
      if (!response.headersSent)
        json(response, 500, { error: { code: "fixture_failure" } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fake upstream has no port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const stream of streams) stream.end();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

type AccountRoute =
  | "account"
  | "model-keys"
  | "account-safety"
  | "thread-safety";

function accountResponse(method: string, path: string): AccountRoute | null {
  if (method !== "GET") return null;
  if (path === "/api/account") return "account";
  if (path === "/api/account/model-keys") return "model-keys";
  if (path === "/api/account/transaction-safety") return "account-safety";
  if (path === "/api/thread/transaction-safety") return "thread-safety";
  return null;
}

function accountBody(route: AccountRoute, principal: Principal) {
  if (route === "model-keys") return { keys: [] };
  if (route !== "account")
    return {
      mode: "balanced",
      revision: 1,
      scope: route === "thread-safety" ? "thread" : "account_default",
      source: "default",
    };
  const now = Math.floor(Date.now() / 1000);
  return {
    user: {
      user_id: principal.sub,
      username: null,
      apps: [],
      tier: "free",
      verified_email: null,
      status: "active",
      last_seen_at: now,
      created_at: now,
      updated_at: now,
    },
    auth_providers: [],
    user_accounts: [],
    signing_policies: [],
    delegated_accounts: [],
    operating_accounts: [],
    onchain_policy_bindings: [],
  };
}

function catalogResponse(path: string): unknown {
  if (path.endsWith("/models")) return ["fixture-model"];
  if (path.endsWith("/apps"))
    return [{ name: "default", is_public: true, is_active: true }];
  if (path === "/api/resource/skills") return { skills: [] };
  return undefined;
}

const statement = {
  entries: [
    {
      usage_event_id: "fixture-usage-1",
      execution_id: "fixture-operation-1",
      application_id: null,
      provider: "openai",
      model: "fixture-model",
      input_tokens: 1200,
      output_tokens: 300,
      funding: { kind: "platform", application_id: null },
      gross: 125_000,
      included: 100_000,
      credits: 25_000,
      details: {},
      occurred_at: 1_700_000_000,
    },
  ],
  next_cursor: null,
};

const credits = {
  period_utc_month: "2026-09",
  included_limit: 10_000_000,
  included_used: 1_250_000,
  included_remaining: 8_750_000,
  balance: 25_000_000,
  outstanding_debt: 0,
  records: [],
  next_before_id: null,
};

/** EdDSA bearer issued by the development BFF for a user, or null. */
function verifyBearer(
  request: IncomingMessage,
  audience: string,
): Principal | null {
  const token = /^Bearer\s+(.+)$/i.exec(
    request.headers.authorization ?? "",
  )?.[1];
  const [header, payload, signature] = token?.split(".") ?? [];
  if (!header || !payload || !signature) return null;
  const signed = verify(
    null,
    Buffer.from(`${header}.${payload}`),
    bffPublicKey,
    Buffer.from(signature, "base64url"),
  );
  if (!signed) return null;
  const protectedHeader = decode(header);
  const claims = decode(payload);
  const audiences = [claims.aud].flat();
  if (
    protectedHeader.alg !== "EdDSA" ||
    protectedHeader.kid !== "aomi-bff-dev-1" ||
    claims.iss !== "aomi-bff" ||
    !audiences.includes(audience) ||
    claims.role !== "user" ||
    typeof claims.sub !== "string" ||
    (typeof claims.exp === "number" && claims.exp * 1000 < Date.now())
  )
    return null;
  return {
    sub: claims.sub,
    iss: claims.iss,
    aud: claims.aud,
    role: claims.role,
    scope: claims.scope,
    resource: claims.resource,
    auth_source: claims.auth_source,
    principal_class: claims.principal_class,
    sid: claims.sid,
    kid: protectedHeader.kid,
  };
}

function decode(part: string): Record<string, any> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function recordFor(
  request: IncomingMessage,
  url: URL,
  principal: Principal | null,
): UpstreamRecord {
  return {
    method: request.method ?? "GET",
    path: url.pathname,
    query: url.search,
    headers: Object.fromEntries(
      Object.entries(request.headers)
        .filter(([name]) => name !== "authorization" && name !== "cookie")
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    authorization: request.headers.authorization
      ? "verified-bff-bearer"
      : "absent",
    cookie: request.headers.cookie ? "present" : "absent",
    principal,
  };
}

function flatHeaders(request: IncomingMessage) {
  return Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(",") : value,
    ]),
  );
}

function json(response: ServerResponse, status: number, body?: unknown) {
  response.statusCode = status;
  if (body === undefined) return void response.end();
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}
