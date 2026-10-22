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
  /** Commits by ref for `/v1/commits/:ref`, seeded with POST /__commits. */
  const commits = new Map<string, { owner: string; view: unknown }>();
  /** Each account's pause all over its agent wallets. */
  const pausedAll = new Map<string, boolean>();
  /** Each account's connection settings, by connection key. */
  const settings = new Map<string, ConnectionSetting>();
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
      commits.clear();
      pausedAll.clear();
      settings.clear();
      for (const agent of agents.values()) agent.reset();
      return json(response, 204);
    }

    if (url.pathname === "/__commits" && method === "POST") {
      const seed = JSON.parse(await readBody(request)) as {
        ref: string;
        owner: string;
        view: unknown;
      };
      commits.set(seed.ref, { owner: seed.owner, view: seed.view });
      return json(response, 204);
    }

    // Thread-less commit refs: the BFF forwards them like /api/commits, with
    // an account bearer. A stranger's ref answers 404, never 403.
    if (url.pathname.startsWith("/v1/commits/")) {
      const principal = verifyBearer(request, "aomi-backend");
      record(principal);
      if (!principal)
        return json(response, 401, { error: { code: "invalid_token" } });
      const [, , , ref = "", ...rest] = url.pathname.split("/");
      const commit = commits.get(decodeURIComponent(ref));
      if (!commit || commit.owner !== principal.sub)
        return json(response, 404, { code: "commit_not_found", status: 404 });
      // Step 4: only a portal or CLI login may approve a parked commit.
      const approver =
        principal.auth_source === "session" ||
        principal.auth_source === "cli_session";
      const view = commit.view as Record<string, unknown>;
      if (method === "GET" && rest.length === 0)
        return json(response, 200, {
          ...view,
          can_approve: approver && view.state === "awaiting_approval",
        });
      if (method === "POST" && rest.join("/") === "approve") {
        const body = JSON.parse(await readBody(request)) as {
          version: number;
          review_digest: string;
        };
        if (!approver)
          return json(response, 403, {
            code: "commit_approval_forbidden",
            status: 403,
          });
        if (view.state !== "awaiting_approval")
          return json(response, 409, {
            code: "commit_not_awaiting_approval",
            status: 409,
          });
        const digest =
          (view.review as { digest?: string } | null)?.digest ?? "";
        if (body.version !== view.version || body.review_digest !== digest)
          return json(response, 409, {
            code: "commit_version_conflict",
            status: 409,
          });
        const approved = {
          ...view,
          version: (view.version as number) + 1,
          state: "needs_signature",
          approval: {
            ...(view.approval as object),
            state: "approved",
            approved_at: Math.floor(Date.now() / 1000),
            approved_by: principal.auth_source === "session" ? "portal" : "cli",
          },
        };
        commit.view = approved;
        return json(response, 200, { ...approved, can_approve: false });
      }
      return json(response, 404, {
        error: { code: "fixture_route_not_found" },
      });
    }

    // The account's wallet list and balances: one funded EVM agent wallet
    // ("Trading") per account, so Settings renders the agent band; pause-all
    // and each connection's label and wallet lanes.
    if (
      url.pathname.startsWith("/v1/account/wallets") ||
      url.pathname.startsWith("/v1/account/agent-wallets") ||
      url.pathname === "/v1/account/pause-all" ||
      url.pathname.startsWith("/v1/account/connection-settings/") ||
      /^\/v1\/account\/connections\/[^/]+\/wallets$/.test(url.pathname)
    ) {
      const principal = verifyBearer(request, "aomi-backend");
      record(principal);
      if (!principal)
        return json(response, 401, { error: { code: "invalid_token" } });
      if (method === "GET" && url.pathname === "/v1/account/wallets")
        return json(response, 200, { wallets: [AGENT_WALLET] });
      if (method === "GET" && url.pathname === "/v1/account/agent-wallets")
        return json(response, 200, {
          pause_all: pausedAll.get(principal.sub) ?? false,
          wallets: [AGENT_GROUP],
        });
      if (
        method === "GET" &&
        url.pathname === `/v1/account/wallets/${AGENT_WALLET.id}/balance`
      )
        return json(response, 200, AGENT_BALANCE);
      // The backend's require_portal_session for writes.
      const portalOnly = () =>
        principal.auth_source === "session"
          ? null
          : json(response, 403, { error: "portal_session_required" });
      if (method === "PUT" && url.pathname === "/v1/account/pause-all") {
        const refused = portalOnly();
        if (refused) return refused;
        const { paused } = JSON.parse(await readBody(request)) as {
          paused: boolean;
        };
        pausedAll.set(principal.sub, paused);
        return json(response, 200, { pause_all: paused });
      }
      if (
        method === "PUT" &&
        url.pathname.startsWith("/v1/account/connection-settings/")
      ) {
        const refused = portalOnly();
        if (refused) return refused;
        const key = decodeURIComponent(url.pathname.split("/").pop()!);
        const id = `${principal.sub}\0${key}`;
        const update = JSON.parse(await readBody(request)) as Partial<
          Omit<ConnectionSetting, "key">
        >;
        const next = {
          ...(settings.get(id) ?? { key, label: null, last_used_at: null }),
          ...update,
        };
        settings.set(id, next);
        return json(response, 200, next);
      }
      if (method === "PUT" && url.pathname.endsWith("/wallets")) {
        const refused = portalOnly();
        if (refused) return refused;
        return json(response, 200, JSON.parse(await readBody(request)));
      }
      return json(response, 404, { error: "wallet_not_found" });
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

const AGENT_WALLET = {
  id: "w_900",
  kind: "agent",
  family: "evm",
  address: "0x7a3f5e1d2c4b6a8901234567890abcdef012c41e",
  label: "Trading",
  custom_label: null,
  browser_app: null,
  provider: "para",
  created_at: 1_760_000_000,
  agent_wallet_id: "6f1c2b8e-0000-4000-8000-000000000900",
  maker_app: null,
} as const;

const AGENT_GROUP = {
  id: AGENT_WALLET.agent_wallet_id,
  name: AGENT_WALLET.label,
  paused: false,
  archived_at: null,
  app: null,
  last_used_at: null,
  created_at: AGENT_WALLET.created_at,
  addresses: [
    {
      family: "evm",
      address: AGENT_WALLET.address,
      wallet_id: AGENT_WALLET.id,
    },
  ],
  connections: [],
};

type ConnectionSetting = {
  key: string;
  label: string | null;
  last_used_at: number | null;
};

const AGENT_BALANCE = {
  id: AGENT_WALLET.id,
  family: "evm",
  address: AGENT_WALLET.address,
  as_of: 1_760_000_000,
  total_usd: "412.80",
  chains: [
    {
      chain: "8453",
      name: "Base",
      native_symbol: "ETH",
      source: "indexed",
      native: { amount: "0.004", usd: "10.20" },
      tokens: [
        {
          symbol: "USDC",
          address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          amount: "402.60",
          usd: "402.60",
        },
      ],
      error: null,
    },
    {
      chain: "1",
      name: "Ethereum",
      native_symbol: "ETH",
      source: "indexed",
      native: null,
      tokens: [],
      error: null,
    },
  ],
};

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
