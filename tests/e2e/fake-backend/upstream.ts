// The agent backend as the Portal's BFF sees it: public catalogs, account
// reads and /v1/agent/*, each request checked for the bearer the BFF signs
// with the committed development key. Agent threads are kept per account so
// one account can never read another's chat.
import { createPrivateKey, createPublicKey, verify } from "node:crypto";
import type {
  CreditBalance,
  CreditLedger,
} from "../../../packages/client/src/account/credits";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { FakeAgentBackend, type FakeRequest } from "./backend";
import { readBody, sendFakeResponse } from "./server";

import { bffPrivateKey, trustedDevIssuers } from "../edge-keys";

export { bffPrivateKey };

/** The development issuers whose bearers the fake accepts: the portal BFF and the edge Worker. */
const trustedKeys = new Map(
  Object.entries(trustedDevIssuers).map(([kid, { issuer, privateKey }]) => [
    kid,
    { issuer, publicKey: createPublicKey(createPrivateKey(privateKey)) },
  ]),
);

export type Principal = {
  sub: string;
  iss?: string;
  aud?: string | string[];
  role?: string;
  scope?: string;
  resource?: string;
  auth_source?: string;
  principal_class?: string;
  client_id?: string;
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
  /** Each connection's lane per agent wallet, by account and connection key. */
  const lanes = new Map<string, { id: string; lane: string }[]>();
  /** Each account's rules on its one agent wallet, and its rule changes by id. */
  const walletRules = new Map<string, FakeRules>();
  const ruleChanges = new Map<string, { owner: string; change: FakeChange }>();
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
      lanes.clear();
      walletRules.clear();
      ruleChanges.clear();
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
      const view = commit.view as Record<string, unknown>;
      // A portal or CLI login approves a parked commit; an OAuth connection
      // only its own, where its lane on the wallet is Ask in that client.
      const own = `oauth:${principal.client_id}`;
      const approver =
        principal.auth_source === "session" ||
        principal.auth_source === "cli_session" ||
        (principal.auth_source === "oauth" &&
          view.initiator === own &&
          (lanes
            .get(`${principal.sub}\0${own}`)
            ?.some(
              (row) => row.id === AGENT_GROUP.id && row.lane === "ask_client",
            ) ??
            false));
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
            approved_by:
              principal.auth_source === "session"
                ? "portal"
                : principal.auth_source === "cli_session"
                  ? "cli"
                  : own,
          },
        };
        commit.view = approved;
        return json(response, 200, { ...approved, can_approve: false });
      }
      return json(response, 404, {
        error: { code: "fixture_route_not_found" },
      });
    }

    // The agent wallet's rules: a change that only takes power away applies
    // at once; one that gives power, or names an admin or an Instant
    // connection, waits as a rule change the owner's own session decides.
    const rulesPath =
      url.pathname === `/v1/account/agent-wallets/${AGENT_GROUP.id}/rules`;
    const changePath =
      /^\/v1\/account\/rule-changes\/([^/]+)(?:\/(approve|decline))?$/.exec(
        url.pathname,
      );
    if (
      rulesPath ||
      changePath ||
      url.pathname === "/v1/account/rules/catalog"
    ) {
      const principal = verifyBearer(request, "aomi-backend");
      record(principal);
      if (!principal)
        return json(response, 401, { error: { code: "invalid_token" } });
      const owner = principal.sub;
      const state =
        walletRules.get(owner) ??
        ({
          revision: 0,
          rules: NO_RULES,
          admin: { kind: "aomi_managed" },
        } as FakeRules);
      walletRules.set(owner, state);
      // A change nobody decided in time is closed before anything reads it.
      const now = Math.floor(Date.now() / 1000);
      for (const { change } of ruleChanges.values())
        if (change.state === "awaiting_admin" && change.expires_at <= now)
          change.state = "expired";
      const pending = [...ruleChanges.values()].find(
        (entry) =>
          entry.owner === owner && entry.change.state === "awaiting_admin",
      )?.change;
      const body = () => rulesBody(state, pending ?? null);
      // The backend's check that the caller is the owner's own session.
      const ownerOnly = () =>
        principal.principal_class === "guest"
          ? json(response, 403, { error: "guest_account" })
          : principal.auth_source === "session" ||
              principal.auth_source === "cli_session"
            ? null
            : json(response, 403, { error: "scope_denied" });
      if (method === "GET" && !rulesPath && !changePath)
        return json(response, 200, RULES_CATALOG);
      if (method === "GET" && rulesPath) return json(response, 200, body());
      if (method === "POST" && rulesPath) {
        const refused = ownerOnly();
        if (refused) return refused;
        const sent = JSON.parse(await readBody(request)) as {
          rules?: Partial<FakeRuleSet>;
          admin?: FakeRules["admin"];
          instant?: string[];
        };
        // A field left out of a write is a rule turned off.
        const next = sent.rules ? { ...NO_RULES, ...sent.rules } : state.rules;
        const waits =
          Boolean(sent.admin || sent.instant?.length) ||
          loosens(state.rules, next);
        if (!waits) {
          if (JSON.stringify(next) === JSON.stringify(state.rules))
            return json(response, 200, { status: "unchanged", rules: body() });
          state.rules = next;
          state.revision += 1;
          return json(response, 200, { status: "applied", rules: body() });
        }
        if (pending)
          return json(response, 409, { error: "rules_change_pending" });
        const change: FakeChange = {
          id: `00000000-0000-4000-8000-${String(ruleChanges.size + 1).padStart(12, "0")}`,
          agent_wallet_id: AGENT_GROUP.id,
          wallet_name: AGENT_GROUP.name,
          lines: [{ text: "Rules: gives the agent more", loosens: true }],
          state: "awaiting_admin",
          proposed_by:
            principal.auth_source === "cli_session" ? "cli" : "portal",
          expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
          signer: state.admin.kind === "wallet" ? state.admin : null,
          sign_message:
            state.admin.kind === "wallet" ? "Aomi rule change" : null,
          apply: {
            rules: next,
            admin: sent.admin ?? state.admin,
            instant: sent.instant ?? [],
            // The rules it was filed against: approval is refused once they move.
            revision: state.revision,
          },
        };
        ruleChanges.set(change.id, { owner, change });
        return json(response, 200, {
          status: "waiting",
          rules: rulesBody(state, change),
        });
      }
      const entry = changePath && ruleChanges.get(changePath[1]!);
      // A stranger's change answers 404, never 403.
      if (!entry || entry.owner !== owner)
        return json(response, 404, { error: "rules_change_not_found" });
      const { apply, ...view } = entry.change;
      if (method === "GET" && !changePath![2]) return json(response, 200, view);
      if (method === "POST" && changePath![2]) {
        const refused = ownerOnly();
        if (refused) return refused;
        if (view.state !== "awaiting_admin")
          return json(response, 409, { error: "rules_change_not_open" });
        if (changePath![2] === "decline") entry.change.state = "declined";
        else if (apply.revision !== state.revision) {
          // A cut applied while it waited: approving would undo that cut.
          return json(response, 409, { error: "rules_changed" });
        } else {
          const sent = JSON.parse((await readBody(request)) || "{}") as {
            signature?: string;
          };
          if (view.signer && !sent.signature)
            return json(response, 403, { error: "rules_signature_required" });
          entry.change.state = "applied";
          state.rules = apply.rules;
          state.admin = apply.admin;
          state.revision += 1;
          for (const key of apply.instant)
            lanes.set(`${owner}\0${key}`, [
              { id: AGENT_GROUP.id, lane: "instant" },
            ]);
        }
        return json(response, 200, rulesBody(state, null));
      }
      return json(response, 404, { error: "not_found" });
    }

    // The account's wallet list: one EVM agent wallet
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
        const key = decodeURIComponent(url.pathname.split("/").at(-2)!);
        const update = JSON.parse(await readBody(request)) as {
          wallets: { id: string; lane: string }[];
        };
        lanes.set(`${principal.sub}\0${key}`, update.wallets);
        return json(response, 200, update);
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

    if (
      method === "GET" &&
      (url.pathname === "/v1/account/credits" ||
        url.pathname === "/v1/account/credits/ledger" ||
        url.pathname === "/v1/account/statement")
    ) {
      const principal = verifyBearer(request, "aomi-payment");
      record(principal);
      const scope = url.pathname.startsWith("/v1/account/credits")
        ? "account:credits:read"
        : "account:usage:read";
      if (!principal || !principal.scope?.split(" ").includes(scope))
        return json(response, 401, { error: { code: "invalid_token" } });
      return json(
        response,
        200,
        url.pathname.endsWith("/ledger")
          ? creditLedger
          : url.pathname.endsWith("/credits")
            ? credits
            : statement,
      );
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

type FakeRuleSet = {
  apps: string[] | null;
  limits: { asset: string; amount: string }[];
  not_after: number | null;
  owner_only: boolean;
};
const NO_RULES: FakeRuleSet = {
  apps: null,
  limits: [],
  not_after: null,
  owner_only: false,
};
type FakeAdmin =
  | { kind: "aomi_managed" }
  | { kind: "wallet"; family: "evm" | "svm"; address: string };
type FakeRules = { revision: number; rules: FakeRuleSet; admin: FakeAdmin };
type FakeChange = {
  id: string;
  agent_wallet_id: string;
  wallet_name: string;
  lines: { text: string; loosens: boolean }[];
  state: "awaiting_admin" | "applied" | "declined" | "expired";
  proposed_by: string;
  expires_at: number;
  signer: FakeAdmin | null;
  sign_message: string | null;
  /** What approving it puts in force. */
  apply: {
    rules: FakeRuleSet;
    admin: FakeAdmin;
    /** Connections it makes Instant on the wallet. */
    instant: string[];
    revision: number;
  };
};

const RULES_CATALOG = {
  apps: [
    { id: "uniswap", label: "Uniswap", chains: ["eip155:1", "eip155:8453"] },
    { id: "jupiter", label: "Jupiter", chains: ["solana:mainnet-beta"] },
  ],
  tokens: [
    {
      asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      symbol: "USDC",
      decimals: 6,
      chain: "Base",
    },
    {
      asset: "solana:mainnet-beta/native",
      symbol: "SOL",
      decimals: 9,
      chain: "Solana",
    },
  ],
};

/** Whether `next` gives the agent anything `current` did not. */
function loosens(current: FakeRuleSet, next: FakeRuleSet): boolean {
  const was = current.limits;
  const now = next.limits;
  if (was.length && !now.length) return true;
  if (
    now.some((limit) => {
      const before = was.find((entry) => entry.asset === limit.asset);
      return before
        ? BigInt(limit.amount) > BigInt(before.amount)
        : was.length > 0;
    })
  )
    return true;
  if (
    current.apps &&
    (!next.apps || next.apps.some((app) => !current.apps!.includes(app)))
  )
    return true;
  if (
    current.not_after !== null &&
    (next.not_after === null || next.not_after > current.not_after)
  )
    return true;
  return current.owner_only && !next.owner_only;
}

function rulesBody(state: FakeRules, pending: FakeChange | null) {
  const { apply: _, ...view } = pending ?? ({} as FakeChange);
  return {
    agent_wallet_id: AGENT_GROUP.id,
    wallet_name: AGENT_GROUP.name,
    revision: state.revision,
    rules: {
      ...state.rules,
      limits: state.rules.limits.map((limit) => {
        const token = RULES_CATALOG.tokens.find(
          (entry) => entry.asset === limit.asset,
        );
        return {
          ...limit,
          symbol: token?.symbol ?? null,
          decimals: token?.decimals ?? null,
        };
      }),
    },
    sentences: [
      ...(state.rules.apps ? [`Can use ${state.rules.apps.join(", ")}`] : []),
      ...state.rules.limits.map((limit) => {
        const token = RULES_CATALOG.tokens.find(
          (entry) => entry.asset === limit.asset,
        );
        return token
          ? `Up to ${Number(limit.amount) / 10 ** token.decimals} ${token.symbol} a day on ${token.chain}`
          : `Up to ${limit.amount} base units of ${limit.asset} a day`;
      }),
      ...(state.rules.not_after === null
        ? []
        : [
            `Until ${new Date(state.rules.not_after * 1000).toISOString().slice(0, 10)}`,
          ]),
      ...(state.rules.owner_only || state.rules.apps
        ? ["Sends only to your wallets"]
        : []),
    ],
    admin: state.admin,
    stopped_until: null,
    usage: [],
    window_ends_at: (Math.floor(Date.now() / 86_400_000) + 1) * 86_400,
    pending: pending ? view : null,
    enforced_by: ["aomi"],
    // One linked wallet, so the admin picker has a wallet to choose.
    admin_wallets: [
      {
        kind: "wallet",
        family: "evm",
        address: "0x00000000000000000000000000000000000000a1",
      },
    ],
  };
}

type ConnectionSetting = {
  key: string;
  label: string | null;
  last_used_at: number | null;
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

const creditLedger: CreditLedger = {
  next_before_id: null,
  entries: [
    {
      id: 1,
      amount_microusd: 25_000_000,
      entry_kind: "purchase",
      created_at: Date.parse("2026-09-15T12:00:00.000Z") / 1000,
      payment_method: "card",
      payment_provider: "stripe",
    },
  ],
};

const credits: CreditBalance = {
  period_utc_month: "2026-09",
  included: {
    limit_microusd: 10_000_000,
    used_microusd: 1_250_000,
    remaining_microusd: 8_750_000,
  },
  balance_microusd: 25_000_000,
  reserved_microusd: 0,
  available_microusd: 25_000_000,
  debt_microusd: 0,
};

/** EdDSA bearer issued for a user by a trusted development issuer, or null. */
function verifyBearer(
  request: IncomingMessage,
  audience: string,
): Principal | null {
  const token = /^Bearer\s+(.+)$/i.exec(
    request.headers.authorization ?? "",
  )?.[1];
  const [header, payload, signature] = token?.split(".") ?? [];
  if (!header || !payload || !signature) return null;
  const protectedHeader = decode(header);
  const trusted = trustedKeys.get(protectedHeader.kid);
  if (!trusted) return null;
  const signed = verify(
    null,
    Buffer.from(`${header}.${payload}`),
    trusted.publicKey,
    Buffer.from(signature, "base64url"),
  );
  if (!signed) return null;
  const claims = decode(payload);
  const audiences = [claims.aud].flat();
  if (
    protectedHeader.alg !== "EdDSA" ||
    claims.iss !== trusted.issuer ||
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
