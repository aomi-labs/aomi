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
  /** Each connection's ask mode per agent wallet, by account and connection key. */
  const askModes = new Map<string, { id: string; ask_mode: string }[]>();
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
      askModes.clear();
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
      // only its own, where its ask mode on the wallet is Ask in that client.
      const own = `oauth:${principal.client_id}`;
      const approver =
        principal.auth_source === "session" ||
        principal.auth_source === "cli_session" ||
        (principal.auth_source === "oauth" &&
          view.initiator === own &&
          (askModes
            .get(`${principal.sub}\0${own}`)
            ?.some(
              (row) =>
                row.id === AGENT_GROUP.id && row.ask_mode === "ask_client",
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
      url.pathname === `/v1/account/agent-wallets/${AGENT_GROUP.id}/policy`;
    const changePath =
      /^\/v1\/account\/policy-changes\/([^/]+)(?:\/(approve|decline))?$/.exec(
        url.pathname,
      );
    const stepPrefix = `/v1/account/agent-wallets/${AGENT_GROUP.id}/policy/enforcement/`;
    const stepPath = url.pathname.startsWith(stepPrefix)
      ? /^([^/]+)\/(prepare|confirm)$/.exec(
          url.pathname.slice(stepPrefix.length),
        )
      : null;
    if (
      rulesPath ||
      changePath ||
      stepPath ||
      url.pathname === "/v1/account/policy/catalog"
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
          deployed: {},
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
      // True once it has answered 403: `json` returns nothing to test.
      const ownerOnly = () => {
        const error =
          principal.principal_class === "guest"
            ? "guest_account"
            : principal.auth_source === "session" ||
                principal.auth_source === "cli_session"
              ? null
              : "scope_denied";
        if (error) json(response, 403, { error });
        return error !== null;
      };
      if (method === "GET" && !rulesPath && !changePath && !stepPath)
        return json(response, 200, RULES_CATALOG);
      if (method === "GET" && rulesPath) return json(response, 200, body());
      if (method === "POST" && stepPath) {
        // The owner's own wallet does what prepare answers, and confirm
        // reads the chain (or the signature) and starts a waiting rule.
        if (ownerOnly()) return;
        const provider = PROVIDERS[stepPath[1]!];
        const sent = JSON.parse(await readBody(request)) as {
          network: string;
          rule: string;
          revision: number;
          owner?: string;
          remove?: boolean;
          signature?: string;
        };
        if (!provider || provider.network !== sent.network)
          return json(response, 404, {
            error: "policy_provider_not_found",
            message: `\`${stepPath[1]}\` cannot hold this wallet's rules on \`${sent.network}\``,
          });
        if (sent.revision !== state.revision)
          return json(response, 409, { error: "rules_changed" });
        const rule = state.rules.rules.find(
          (entry) => fakeRuleKey(entry) === sent.rule,
        );
        const held = state.deployed[sent.rule];
        if (!rule && !held)
          return json(response, 404, { error: "rule_not_found" });
        // A rule that was removed or has ended is taken off without `remove`.
        const removing =
          sent.remove === true ||
          !rule ||
          (rule.active_until !== undefined && rule.active_until <= now);
        // The owner signed the revocation of a removed rule's grant: sending
        // it, a plain transaction from their own wallet, is what is left.
        const sending = !rule && held?.revoked === true;
        if (stepPath[2] === "prepare") {
          const current = removing
            ? !held
            : held?.amount === rule.amount &&
              held?.active_until === rule.active_until;
          // A removed rule has no rule left: the step is about what is held.
          return json(response, 200, {
            action: current
              ? null
              : sending
                ? sendAction(provider)
                : stepAction(provider, (rule ?? held)!),
          });
        }
        // A grant, and the revoking of one, are signatures; a deployment
        // that is already gone, and a sent revocation, need none.
        if (
          provider.family === "evm" &&
          (!removing || held) &&
          !sending &&
          !/^0x[0-9a-f]+$/i.test(sent.signature ?? "")
        )
          return json(response, 422, {
            error: "invalid_policy",
            message: "A signature is required to confirm a grant",
          });
        if (removing && provider.family === "evm" && held && !sending) {
          // The signed revocation is kept; the grant stays until it is sent.
          held.revoked = true;
        } else if (removing) delete state.deployed[sent.rule];
        else if (rule) {
          state.deployed[sent.rule] = {
            amount: rule.amount,
            active_until: rule.active_until,
            // A grant is a signature: nothing is deployed, so no transaction.
            tx: provider.family === "svm" ? (sent.signature ?? null) : null,
          };
          if (rule.awaiting) {
            delete rule.awaiting;
            rule.active_from = now;
          }
        }
        return json(response, 200, { rules: body() });
      }
      if (method === "POST" && rulesPath) {
        if (ownerOnly()) return;
        const sent = JSON.parse(await readBody(request)) as {
          rules?: Partial<Omit<FakeRuleSet, "rules">> & {
            rules?: Omit<FakeRule, "active_from">[];
          };
          admin?: FakeRules["admin"];
          instant?: string[];
          revision?: number;
        };
        // Built from rules that moved since: refused, never overwritten.
        if (sent.revision !== undefined && sent.revision !== state.revision)
          return json(response, 409, { error: "rules_changed" });
        // A rule keeps its start unless it is new or its amount or end moved;
        // a new or moved end must be in the future.
        const held = new Map(
          state.rules.rules.map((rule) => [fakeRuleKey(rule), rule]),
        );
        let periodInvalid = false;
        const rules = (sent.rules?.rules ?? []).map((rule) => {
          const before = held.get(fakeRuleKey(rule));
          const same =
            before &&
            before.amount === rule.amount &&
            before.active_until === rule.active_until;
          if (!same && rule.active_until !== undefined)
            periodInvalid ||= rule.active_until <= now;
          if (same) return { ...rule, ...stored(before) };
          // A new rule a provider can hold starts when the owner signs its
          // deployment, not before; any other starts at once.
          const holder =
            sent.rules?.mode === "whitelist" &&
            !state.deployed[fakeRuleKey(rule)]
              ? providerOf(rule, sent.rules.mode)
              : undefined;
          return holder
            ? { ...rule, awaiting: holder }
            : { ...rule, active_from: now };
        });
        if (periodInvalid)
          return json(response, 400, { error: "rules_period_invalid" });
        // A field left out of a write is a rule turned off.
        const next: FakeRuleSet = sent.rules
          ? { ...NO_RULES, ...sent.rules, rules }
          : state.rules;
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
        if (ownerOnly()) return;
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
            askModes.set(`${owner}\0${key}`, [
              { id: AGENT_GROUP.id, ask_mode: "instant" },
            ]);
        }
        return json(response, 200, rulesBody(state, null));
      }
      return json(response, 404, { error: "not_found" });
    }

    // The account's wallet list: one EVM agent wallet
    // ("Trading") per account, so Settings renders the agent band; pause-all
    // and each connection's label and wallet ask modes.
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
      // True once it has answered 403: `json` returns nothing to test.
      const portalOnly = () => {
        if (principal.auth_source === "session") return false;
        json(response, 403, { error: "portal_session_required" });
        return true;
      };
      if (method === "PUT" && url.pathname === "/v1/account/pause-all") {
        if (portalOnly()) return;
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
        if (portalOnly()) return;
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
        if (portalOnly()) return;
        const key = decodeURIComponent(url.pathname.split("/").at(-2)!);
        const update = JSON.parse(await readBody(request)) as {
          wallets: { id: string; ask_mode: string }[];
        };
        askModes.set(`${principal.sub}\0${key}`, update.wallets);
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

type FakeTo =
  | { kind: "any_protocol" }
  | { kind: "protocol"; id: string }
  | { kind: "address"; address: string };
/** A rule as the fake holds it; `amount` is a total that never resets. */
type FakeRule = {
  asset: string;
  amount: string;
  to: FakeTo;
  /** Unix seconds; set here, never by the client. Unset while `awaiting`. */
  active_from?: number;
  /** The provider whose deployment starts the rule; it has not started yet. */
  awaiting?: string;
  /** Unix seconds; left out, the rule is always on. */
  active_until?: number;
};
type FakeRuleSet = {
  mode: "whitelist" | "blacklist";
  rules: FakeRule[];
  linked_only: boolean;
};
const NO_RULES: FakeRuleSet = {
  mode: "blacklist",
  rules: [],
  linked_only: false,
};
/** A rule's key as the backend writes it: `<asset>@<to>`. */
const fakeRuleKey = ({ asset, to }: Pick<FakeRule, "asset" | "to">) =>
  `${asset}@${
    to.kind === "any_protocol"
      ? "any"
      : to.kind === "protocol"
        ? `protocol:${to.id}`
        : `address:${to.address.startsWith("0x") ? to.address.toLowerCase() : to.address}`
  }`;
/** The two on-chain providers: one deployment per rule, by rule key. */
const PROVIDERS: Record<
  string,
  { name: string; network: string; family: "evm" | "svm"; owner: string }
> = {
  // Swig deploys a transaction on Solana.
  swig: {
    name: "Swig",
    network: "solana:mainnet-beta",
    family: "svm",
    owner: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
  },
  // MetaMask holds an EVM rule by a signed grant: nothing is deployed.
  metamask: {
    name: "MetaMask",
    network: "eip155:8453",
    family: "evm",
    owner: "0x00000000000000000000000000000000000000a1",
  },
};
/**
 * What each provider could hold for the wallet before any rule exists: the
 * backend's `providers`, one per provider and network it is switched on for.
 */
const PROVIDER_HOLDS: Record<
  string,
  { holds: "total_and_period" | "total_period_and_destination"; note: string }
> = {
  swig: {
    holds: "total_period_and_destination",
    note: "Holds a rule's total, its end and where it may go.",
  },
  metamask: {
    holds: "total_and_period",
    note: "Holds a rule's total and its end on chain. A rule to an address also holds that destination; for an app the destination is checked by Aomi only.",
  },
};
const providersOf = () =>
  Object.entries(PROVIDERS).map(([id, provider]) => ({
    provider: id,
    name: provider.name,
    network: provider.network,
    ...PROVIDER_HOLDS[id]!,
  }));
/** The provider that can hold `rule`: whitelist mode, a total above zero. */
const providerOf = (rule: FakeRule, mode: FakeRuleSet["mode"]) =>
  mode === "whitelist" && rule.amount !== "0"
    ? Object.keys(PROVIDERS).find((id) =>
        rule.asset.startsWith(`${PROVIDERS[id]!.network}/`),
      )
    : undefined;
/** What a stored rule already says about its start. */
const stored = (rule: FakeRule) => ({
  ...(rule.active_from !== undefined ? { active_from: rule.active_from } : {}),
  ...(rule.awaiting ? { awaiting: rule.awaiting } : {}),
});
/** The owner's signed revocation, as a transaction for their wallet to send. */
const sendAction = (provider: (typeof PROVIDERS)[string]) => ({
  kind: "evm_transaction",
  network: provider.network,
  to: "0xdb9b1e94b5b69df7e401ddbede43491141047db3",
  data: "0xcafe0001",
  value: "0x0",
});
/** What the owner's wallet does to hold `rule` with `provider`. */
function stepAction(
  provider: (typeof PROVIDERS)[string],
  rule: Pick<FakeRule, "amount" | "active_until">,
) {
  if (provider.family === "svm")
    return {
      kind: "transaction",
      network: provider.network,
      unsigned_base64: "AQAB",
    };
  return {
    kind: "typed_data",
    network: provider.network,
    typed_data: {
      domain: {
        name: "DelegationManager",
        version: "1",
        chainId: Number(provider.network.split(":")[1]),
        verifyingContract: "0x00000000000000000000000000000000000000d1",
      },
      types: {
        Delegation: [
          { name: "delegate", type: "address" },
          { name: "authority", type: "bytes32" },
          { name: "salt", type: "uint256" },
          { name: "total", type: "uint256" },
          { name: "validUntil", type: "uint256" },
        ],
      },
      primaryType: "Delegation",
      // Numbers above 2^53 go as decimal strings.
      message: {
        delegate: "0x00000000000000000000000000000000000000a9",
        authority: `0x${"ff".repeat(32)}`,
        salt: "98765432109876543210",
        total: rule.amount,
        validUntil: String(rule.active_until ?? 0),
      },
    },
  };
}
type FakeAdmin =
  | { kind: "aomi_managed" }
  | { kind: "wallet"; family: "evm" | "svm"; address: string };
type FakeRules = {
  revision: number;
  rules: FakeRuleSet;
  admin: FakeAdmin;
  /** What each provider holds on chain, by rule key. */
  deployed: Record<
    string,
    {
      amount: string;
      active_until?: number;
      tx: string | null;
      /** The owner signed the grant's revocation; nothing has sent it yet. */
      revoked?: boolean;
    }
  >;
};
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
  if (current.mode === "whitelist" && next.mode === "blacklist") return true;
  if (current.linked_only && !next.linked_only) return true;
  const was = new Map(current.rules.map((rule) => [fakeRuleKey(rule), rule]));
  const now = new Set(next.rules.map(fakeRuleKey));
  // In a blacklist a rule is a cap: taking one away gives the agent more.
  if (
    next.mode === "blacklist" &&
    current.rules.some((rule) => !now.has(fakeRuleKey(rule)))
  )
    return true;
  return next.rules.some((rule) => {
    const before = was.get(fakeRuleKey(rule));
    // In a whitelist a new rule allows something that was not.
    if (!before) return next.mode === "whitelist" && rule.amount !== "0";
    if (BigInt(rule.amount) > BigInt(before.amount)) return true;
    return (
      before.active_until !== undefined &&
      (rule.active_until === undefined ||
        rule.active_until > before.active_until)
    );
  });
}

/** One entry per rule and provider, as the chain would show it. */
function enforcementOf(state: FakeRules) {
  const entry = (
    key: string,
    id: string,
    extra: {
      state: string;
      ready: boolean;
      note?: string;
      next?: string;
    },
    until?: number,
  ) => {
    const provider = PROVIDERS[id]!;
    const held = state.deployed[key];
    return {
      rule: key,
      provider: id,
      name: provider.name,
      network: provider.network,
      state: extra.state,
      ready: extra.ready,
      // A deployment counts its total down; the fake shows it untouched.
      left: held ? held.amount : null,
      expires_at: held && until !== undefined ? until + 600 : null,
      account: held ? provider.owner : null,
      deployment_tx: held?.tx ?? null,
      note: extra.note ?? null,
      next:
        extra.next ??
        (!extra.ready
          ? null
          : provider.family === "svm"
            ? "transaction"
            : "typed_data"),
      signer: {
        family: provider.family,
        address: held ? provider.owner : null,
      },
    };
  };
  const entries = state.rules.rules.flatMap((rule) => {
    const key = fakeRuleKey(rule);
    const id = Object.keys(PROVIDERS).find((candidate) =>
      rule.asset.startsWith(`${PROVIDERS[candidate]!.network}/`),
    );
    // A rule no provider can hold has no entry: another chain, or a
    // blacklist, in which nothing goes on chain.
    if (!id || state.rules.mode !== "whitelist") return [];
    if (rule.amount === "0")
      return [
        entry(key, id, {
          state: "off",
          ready: false,
          note: `${PROVIDERS[id]!.name} cannot hold a rule that allows nothing.`,
        }),
      ];
    const held = state.deployed[key];
    const current =
      held?.amount === rule.amount && held?.active_until === rule.active_until;
    return [
      entry(
        key,
        id,
        {
          state: current ? "on" : held ? "behind" : "off",
          ready: !current,
          ...(held && !current
            ? { note: "Your rules changed since you signed." }
            : {}),
        },
        rule.active_until,
      ),
    ];
  });
  // A rule removed while its deployment is still on chain keeps its entry.
  const removed = Object.keys(state.deployed)
    .filter(
      (key) => !state.rules.rules.some((rule) => fakeRuleKey(rule) === key),
    )
    .map((key) =>
      entry(
        key,
        Object.keys(PROVIDERS).find((id) =>
          key.startsWith(`${PROVIDERS[id]!.network}/`),
        )!,
        {
          state: "behind",
          ready: true,
          ...(state.deployed[key]?.revoked ? { next: "evm_transaction" } : {}),
          note: state.deployed[key]?.revoked
            ? "Your revocation is signed. Send it from your wallet to take the grant off chain, or wait for Aomi to send it where the network supports that."
            : "This rule was removed or has ended. Sign to take off what the chain holds for it.",
        },
      ),
    );
  return [...entries, ...removed];
}

function rulesBody(state: FakeRules, pending: FakeChange | null) {
  const { apply: _, ...view } = pending ?? ({} as FakeChange);
  const tokenOf = (rule: FakeRule) =>
    RULES_CATALOG.tokens.find((entry) => entry.asset === rule.asset);
  return {
    agent_wallet_id: AGENT_GROUP.id,
    wallet_name: AGENT_GROUP.name,
    revision: state.revision,
    rules: {
      ...state.rules,
      rules: state.rules.rules.map((rule) => ({
        id: fakeRuleKey(rule),
        ...rule,
        symbol: tokenOf(rule)?.symbol ?? null,
        decimals: tokenOf(rule)?.decimals ?? null,
      })),
    },
    sentences: [
      ...state.rules.rules.map((rule) => {
        const token = tokenOf(rule);
        const where =
          rule.to.kind === "any_protocol"
            ? "on any protocol"
            : rule.to.kind === "protocol"
              ? `on ${rule.to.id}`
              : `to ${rule.to.address}`;
        return token
          ? `Up to ${Number(rule.amount) / 10 ** token.decimals} ${token.symbol} ${where} (${token.chain})`
          : `Up to ${rule.amount} base units of ${rule.asset} ${where}`;
      }),
      ...(state.rules.linked_only ? ["Sends only to your linked wallets"] : []),
    ],
    admin: state.admin,
    stopped_until: null,
    pending: pending ? view : null,
    enforced_by: Object.fromEntries(
      state.rules.rules.map((rule) => [fakeRuleKey(rule), ["Aomi"]]),
    ),
    enforcement: enforcementOf(state),
    providers: providersOf(),
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
