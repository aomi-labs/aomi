// @vitest-environment node
/**
 * The plan's "whole v2 SDK in one script", run against a mocked backend.
 * Differences from the plan text, each because the backend has no such thing:
 * a test `baseUrl` and `fetch`; a decoded step has `outcome` and chip
 * objects, so the log line reads `step.outcome` and chip labels;
 * `w.label` (wallets have no name); no `account.keys.set` (BYOK is /api
 * only); and a guard mode instead of `maxPerTx` (the guard has modes, no
 * spending limit).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { Aomi, oauth, isAomiError } from "../index";
import { fileGrants } from "../node";
import { viemSigner } from "../viem";
import type { AomiOAuthGrant, AomiOAuthGrantManager } from "../authorization";
import type { CommitView } from "../commits";
import { decode } from "../trace";
import { createAomiDeviceGrantManager } from "../oauth";

vi.mock("../oauth", () => ({ createAomiDeviceGrantManager: vi.fn() }));

const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const me = privateKeyToAccount(PRIVATE_KEY).address;
const at = Date.parse("2026-10-28T00:00:00Z");

const commit = (id: string, extra: Partial<CommitView> = {}): CommitView => ({
  version: 1,
  commit_id: id,
  thread_id: "thread-1",
  stage_id: `evm:${id}`,
  chain_family: "evm",
  chain_ref: "8453",
  signer: me,
  broadcaster: "hosted",
  state: "needs_signature",
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
  action: {
    kind: "sign",
    payload: {
      kind: "evm_transaction",
      chain_id: 8453,
      signer: me,
      nonce: 1,
      transaction: {
        to: "0x2222222222222222222222222222222222222222",
        value: "0",
        data: "0x",
        gas_limit: 184_220,
        max_fee_per_gas: "2",
        max_priority_fee_per_gas: "1",
      },
    },
  },
  ...extra,
});
const submitted = (view: CommitView): CommitView => ({
  ...view,
  version: view.version + 1,
  state: "submitted",
  action: null,
});
const confirmed = (view: CommitView): CommitView => ({
  ...view,
  version: view.version + 2,
  state: "confirmed",
  action: null,
});

const swap = commit("c-swap");
const parked = commit("c-park", { state: "awaiting_approval", action: null });
const other = commit("7f3c");
const piped = commit("c-pipe", { thread_id: "pipeline:evm:d", stage_id: "s" });
const simulation = {
  status: "passed",
  balanceChanges: [{ asset: "USDC", delta: "312.48" }],
  approvals: [{ token: "ETH" }],
  warnings: [],
  fees: [],
  guards: [],
  gas: null,
  logs: [],
};
const executeEvm = {
  type: "execute_evm",
  commitStages: ["s"],
  transactions: [
    {
      chain_id: 8453,
      from: me,
      to: "0x2222222222222222222222222222222222222222",
      data: "0x",
      label: "Swap",
      kind: "swap",
    },
  ],
  simulation,
};

/** One finished turn on whichever thread asked. */
const turnPage = (sessionId: string) => ({
  session_id: sessionId,
  cursor: "c",
  has_more: false,
  started_turn_id: "turn-1",
  events: [
    {
      type: "tool_complete",
      event_id: "e1",
      sequence: 1,
      turn_id: "turn-1",
      occurred_at: at,
      id: "t1",
      call_id: "call-1",
      tool_name: "evm_simulate_txs",
      result: { gas: 184_220 },
    },
    {
      type: "message",
      event_id: "e2",
      sequence: 2,
      turn_id: "turn-1",
      occurred_at: at,
      sender: "agent",
      content: "Swap is ready.",
    },
    {
      type: "turn_state_changed",
      event_id: "e3",
      sequence: 3,
      turn_id: "turn-1",
      occurred_at: at,
      state: "complete",
    },
  ],
  commits: [swap, parked].map((view) => ({ ...view, thread_id: sessionId })),
});

/** method + path → answer; arrays answer in turn, functions get the body. */
const routes: Record<string, unknown> = {
  "POST /v1/agent/chat": (intent: { sessionId: string }) =>
    Response.json(turnPage(intent.sessionId)),
  "GET /v1/commits/c-swap": { ...swap, sign_url: "https://x/sign/c-swap" },
  "GET /v1/commits/c-park": { ...parked, sign_url: "https://x/sign/c-park" },
  "POST /v1/commits/c-swap/sign": submitted(swap),
  "PATCH /v1/agent/sessions/:id": {
    id: "thread-1",
    title: "Base swaps",
    updatedAt: at,
    archived: false,
  },
  "GET /v1/agent/sessions": { sessions: [], nextCursor: null },
  "GET /v1/pipeline/apps/default/operations": {
    kind: "directory",
    path: "/v1/pipeline/apps/default/operations",
    entries: [],
  },
  "GET /v1/pipeline/apps/default/operations/stage_lifi_swap": {
    kind: "operation",
    name: "stage_lifi_swap",
    description: "",
    method: "POST",
    href: "/v1/pipeline/apps/default/operations/stage_lifi_swap",
    inputSchema: {
      type: "object",
      required: ["topic"],
      properties: { topic: {} },
    },
  },
  "GET /v1/pipeline/apps/default/operations/lifi_get_status": {
    kind: "operation",
    name: "lifi_get_status",
    description: "",
    method: "POST",
    href: "/v1/pipeline/apps/default/operations/lifi_get_status",
    inputSchema: {
      type: "object",
      required: ["topic"],
      properties: { topic: {} },
    },
  },
  "POST /v1/pipeline/apps/default/operations/lifi_get_status": {
    status: "DONE",
  },
  "POST /v1/pipeline/evm/build": {
    version: 2,
    status: "simulated",
    actions: [],
    origin: { app: "default", operations: [] },
    simulation,
    expiresAt: at,
    digest: "d",
    attestation: "a",
  },
  "POST /v1/pipeline/evm/commit": {
    status: "committed",
    digest: "d",
    result: {},
    requests: [executeEvm],
    thread_id: piped.thread_id,
    actions: [
      {
        type: "action",
        event_id: "a",
        sequence: 1,
        turn_id: "t",
        occurred_at: at,
        id: "a-1",
        revision: 1,
        state: "pending",
        request: executeEvm,
        created_at: at,
        expires_at: null,
      },
    ],
    commits: [piped],
  },
  "GET /v1/pipeline/evm/commits/c-pipe": [piped, piped, confirmed(piped)],
  "POST /v1/pipeline/evm/commits/c-pipe/manual": submitted(piped),
  "GET /v1/account": {
    user: { id: "u1" },
    linkedAccounts: [],
    wallets: [],
    session: { betterAuthUserId: "b" },
  },
  "GET /v1/account/wallets": {
    wallets: [
      {
        id: "w_4",
        kind: "agent",
        family: "evm",
        address: "0x8f3a",
        label: "Trading",
        custom_label: null,
        browser_app: null,
        provider: null,
        created_at: 1,
        agent_wallet_id: "aw_1",
        maker_app: null,
      },
    ],
  },
  "GET /v1/account/agent-wallets/aw_1/balances": { networks: [] },
  "GET /v1/account/apps": [[{ name: "polymarket", application_id: 7 }]],
  "POST /v1/account/apps/7": {
    application_id: 7,
    app: "polymarket",
    installed: true,
    apps: ["polymarket"],
  },
  "POST /v1/account/apps/7/secrets": { slots: [] },
  "GET /v1/account/transaction-safety": {
    mode: "guarded_only",
    revision: 2,
    scope: "account_default",
    source: "user",
  },
  "PUT /v1/account/transaction-safety": {
    mode: "balanced",
    revision: 3,
    scope: "account_default",
    source: "user",
  },
  "GET /v1/account/credits": { balance_microusd: 41_200 },
  "GET /v1/commits/7f3c": [other, other, { ...other, version: 2 }],
  "POST /v1/commits/7f3c/sign": () =>
    Response.json(
      { error: { code: "commit_version_conflict", message: "changed" } },
      { status: 409 },
    ),
};

function backend() {
  const seen: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    // OAuth requests arrive as a Request.
    const request = new Request(input, init);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    const text = await request.text();
    seen.push(key);
    const route =
      routes[key] ?? routes[key.replace(/sessions\/[^/]+$/, "sessions/:id")];
    const answer = Array.isArray(route)
      ? route.length > 1
        ? route.shift()
        : route[0]
      : route;
    if (typeof answer === "function")
      return (answer as (body: unknown) => Response)(
        text ? JSON.parse(text) : undefined,
      );
    return answer === undefined
      ? Response.json({ error: `unexpected ${key}` }, { status: 500 })
      : Response.json(answer);
  });
  return { fetch, seen };
}

function deviceManager(): AomiOAuthGrantManager {
  const grants: AomiOAuthGrant[] = [];
  return {
    tokenProvider: async (request) => {
      const grant = {
        issuer: "https://chat.example/api/auth",
        clientId: "client-1",
        accessToken: "access",
        expiresAt: Date.now() + 60_000,
        resource: request.resource,
        scopes: request.scopes,
      };
      grants.push(grant);
      return grant;
    },
    put: vi.fn(),
    grants: async () => grants,
    revoke: vi.fn(),
    clear: vi.fn(),
  };
}

describe("the whole v2 SDK in one script", () => {
  it("runs", async () => {
    const { fetch, seen } = backend();
    const log = vi.fn();
    vi.mocked(createAomiDeviceGrantManager).mockImplementation(
      async (input) => {
        await input.onVerification({
          verificationUri: "https://chat.example/oauth/device",
          userCode: "ABCD",
          expiresAt: at,
        });
        return Object.assign(deviceManager(), { metadata: {} as never });
      },
    );
    const grantsFile = join(
      await mkdtemp(join(tmpdir(), "aomi-")),
      "grants.json",
    );

    // 1 · Setup: sign-in and a signer
    const wallet = createWalletClient({
      account: privateKeyToAccount(PRIVATE_KEY),
      chain: base,
      transport: http(),
    });
    const aomi = new Aomi({
      baseUrl: "https://chat.example",
      fetch,
      auth: oauth({
        clientId: "client-1",
        store: fileGrants(grantsFile),
        onCode: ({ url, code }) => log(`Open ${url}, code ${code}`),
      }),
      signer: { evm: viemSigner(wallet) },
    });
    await aomi.auth.login();
    expect(log).toHaveBeenCalledWith(
      "Open https://chat.example/oauth/device, code ABCD",
    );

    // 2 · Agent: a thread, a turn, its commits
    const thread = aomi.agent.thread();
    const turn = thread.send("Swap 0.1 ETH to USDC on Base");
    for await (const step of turn.steps({ decode })) {
      log(step.outcome, step.title, step.chips.map((c) => c.label).join(" · "));
    }
    expect(log.mock.calls[1]?.[1]).toEqual(expect.any(String));
    const { reply, commits } = await turn;
    expect(reply).toBe("Swap is ready.");
    for (const commit of commits) {
      if (commit.state === "awaiting_approval") {
        log("Approve here:", commit.signUrl);
      } else {
        await commit.sign();
      }
    }
    expect(log).toHaveBeenCalledWith("Approve here:", "https://x/sign/c-park");
    expect(seen).toContain("POST /v1/commits/c-swap/sign");
    await thread.rename("Base swaps");
    await aomi.agent.threads.list({ limit: 10 });
    turn.interrupt();
    const { reply: price } = await aomi.agent.run("ETH price?");
    expect(price).toBe("Swap is ready.");

    // 3 · Pipeline: call operations yourself, no model
    const pipe = aomi.pipeline;
    await pipe.operations();
    const build = await pipe.build("stage_lifi_swap", {
      chain_id: 8453,
      from_token: "ETH",
      to_token: "USDC",
      amount: "0.1",
      slippage_bps: 50,
    });
    for (const change of build.balanceChanges) log(change);
    for (const approval of build.approvals) log(approval);
    log(build.digest, new Date(build.expiresAt));
    const commit = await build.commit();
    await commit.sign();
    await expect(commit.settled()).resolves.toMatchObject({
      state: "confirmed",
    });
    const status = await pipe.invoke("lifi_get_status", {
      commit_id: commit.ref,
    });
    expect(status).toEqual({ status: "DONE" });

    // 4 · Account
    await aomi.account.me();
    const wallets = await aomi.account.wallets.list();
    const trading = wallets.find((w) => w.label === "Trading")!;
    await aomi.account.wallets.balance(trading.id);
    await aomi.account.apps.install("polymarket");
    await aomi.account.apps.credentials("polymarket").set("API_KEY", "key");
    await aomi.account.guard.set({ mode: "balanced" });
    const credits = await aomi.account.credits.get();
    expect(credits).toEqual({ balance_microusd: 41_200 });

    // 5 · A commit by ref, and errors
    const byRef = await aomi.commits.get("7f3c");
    let refreshed = false;
    try {
      await byRef.sign();
    } catch (e) {
      if (isAomiError(e, "commit_stale")) {
        await byRef.refresh();
        refreshed = true;
      } else if (isAomiError(e, "insufficient_scope")) {
        log(e.hint);
      } else {
        throw e;
      }
    }
    expect(refreshed).toBe(true);
    expect(byRef.view.version).toBe(2);

    for (const open of [...commits, commit, byRef]) open.close();
  });
});
