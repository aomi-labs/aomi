// @vitest-environment node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/aomi-cli-test-${process.pid}`;
  process.env.AOMI_STATE_DIR = path;
  return path;
});

import { main, rootHelp } from "./app";

const BASE = "https://chat.example";
const at = Date.parse("2026-10-28T00:00:00Z");
const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SOLANA = Keypair.fromSeed(new Uint8Array(32).fill(7));
const SOLANA_KEY = bs58.encode(SOLANA.secretKey);

const view = (id: string, state: string) => ({
  version: 1,
  commit_id: id,
  thread_id: "thread-1",
  stage_id: `evm:${id}`,
  chain_family: "evm",
  chain_ref: "8453",
  signer: "0x8f3a00000000000000000000000000000000091c2",
  broadcaster: "hosted",
  state,
  transaction_id: null,
  failure_code: null,
  batch: null,
  review: null,
  wallet_attempt: null,
  action: null,
});

const event = (sequence: number, body: object) => ({
  event_id: `e${sequence}`,
  sequence,
  turn_id: "turn-1",
  occurred_at: at,
  ...body,
});

const tool = (sequence: number, name: string, args: object, result: object) =>
  event(sequence, {
    type: "message",
    sender: "agent",
    content: "",
    tool_name: name,
    tool_call_id: `call-${sequence}`,
    tool_arguments: args,
    tool_result: [name, JSON.stringify(result)],
  });

/** A turn that staged, simulated and parked a transfer for approval. */
const turn = {
  session_id: "thread-1",
  cursor: "c",
  has_more: false,
  started_turn_id: "turn-1",
  events: [
    tool(
      1,
      "evm_stage_tx",
      { chain_id: 8453, kind: "native_transfer" },
      { pending_tx_id: 1, chain_id: 8453, current_lifecycle: "queued" },
    ),
    tool(2, "evm_simulate", { tx_ids: [1] }, { success: true }),
    tool(3, "evm_commit_txs", { tx_ids: [1] }, { status: "pending_approval" }),
    event(4, {
      type: "message",
      sender: "agent",
      content: "Transfer is ready.",
    }),
    event(5, { type: "turn_state_changed", state: "complete" }),
  ],
  commits: [view("7f3c", "awaiting_approval")],
};

let requests: { key: string; auth: string | null; body: string }[] = [];
const routes: Record<string, unknown> = {
  "POST /v1/agent/chat": turn,
  "GET /v1/commits/7f3c": {
    ...view("7f3c", "awaiting_approval"),
    sign_url: `${BASE}/sign/7f3c`,
  },
  "POST /api/auth/siwe/nonce": { nonce: "abcdefgh12345678" },
  "POST /api/auth/siwe/verify": { token: "session-token" },
  "POST /api/auth/siws/nonce": {
    nonce: "abcdefgh12345678",
    domain: "chat.example",
    uri: BASE,
  },
  "POST /api/auth/siws/verify": { token: "siws-token" },
  "GET /v1/account": {
    user: { id: "u1", displayName: "0x9965…A4dc" },
    linkedAccounts: [],
    wallets: [],
    session: { betterAuthUserId: "b" },
  },
  "GET /.well-known/oauth-authorization-server": Object.fromEntries(
    [
      ["authorization_endpoint", "oauth2/authorize"],
      ["token_endpoint", "oauth2/token"],
      ["revocation_endpoint", "oauth2/revoke"],
      ["device_authorization_endpoint", "device/code"],
      ["jwks_uri", "jwks"],
    ]
      .map(([key, path]) => [key, `${BASE}/api/auth/${path}`])
      .concat([["issuer", `${BASE}/api/auth`]]),
  ),
  "GET /v1/agent/sessions": {
    sessions: [
      { id: "thread-1", title: "Base swaps", updatedAt: at, archived: false },
    ],
    nextCursor: null,
  },
};

async function cli(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk) => ((stdout += String(chunk)), true),
  );
  vi.spyOn(process.stderr, "write").mockImplementation(
    (chunk) => ((stderr += String(chunk)), true),
  );
  const code = await main(argv);
  vi.restoreAllMocks();
  return { code, stdout, stderr };
}

const state = (value: object) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cli.json"), JSON.stringify(value));
};

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  requests = [];
  process.env.AOMI_BACKEND_URL = BASE;
  delete process.env.AOMI_PRIVATE_KEY;
  delete process.env.AOMI_SOLANA_PRIVATE_KEY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      requests.push({
        key,
        auth: request.headers.get("authorization"),
        body: await request.text(),
      });
      const answer = routes[key];
      if (key === "POST /api/auth/siwe/verify")
        return Response.json(answer, {
          headers: { "set-auth-token": "session-token" },
        });
      return answer === undefined
        ? Response.json({ error: `unexpected ${key}` }, { status: 500 })
        : Response.json(answer);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("help", () => {
  it("prints the root help from the route table", () => {
    expect(rootHelp(false)).toMatchSnapshot();
  });

  it.each([
    [["chat"]],
    [["threads"]],
    [["tx"]],
    [["tx", "approve"]],
    [["wallets"]],
    [["rules"]],
    [["pipeline", "build"]],
  ])("prints %j --help", async (route) => {
    const { code, stdout } = await cli(...route, "--help");
    expect(code).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  it("shows hidden flags under --help-all only", async () => {
    expect((await cli("chat", "--help")).stdout).not.toContain("--backend-url");
    expect((await cli("chat", "--help-all")).stdout).toContain("--backend-url");
  });
});

describe("command validation", () => {
  it.each(["session", "wallet", "app", "byok"])("rejects retired command %s", async (name) => {
    expect((await cli(name)).code).toBe(2);
  });

  it("is a usage error to mistype a command or pass a non-decimal chain", async () => {
    expect((await cli("thraeds")).code).toBe(2);
    expect((await cli("chat", "--chain", "base", "hi")).code).toBe(2);
    expect((await cli("chat", "--chain", "8453abc", "hi")).code).toBe(2);
    expect((await cli("whoami", "--cluster", "localnet")).code).toBe(2);
  });
});

describe("aomi -p", () => {
  beforeEach(() =>
    state({
      thread: "thread-1",
      guest: { baseUrl: BASE, token: "guest-token" },
    }),
  );

  it("traces on stderr, replies on stdout, and exits 3 for an approval", async () => {
    const { code, stdout, stderr } = await cli(
      "-p",
      "swap 0.1 eth to usdc on base",
    );
    expect(code).toBe(3);
    expect(stdout).toBe("Transfer is ready.\n");
    expect(stderr).toMatchInlineSnapshot(`
      "✓ Stage transaction     Base · 1 tx · Native transfer · Staged
      ✓ Simulate transaction  Base · 1 tx
      ◐ Commit transactions   Base · 1 tx · Awaiting approval


      Waiting for you  aomi tx approve 7f3c
      https://chat.example/sign/7f3c
      "
    `);
  });

  it("prints NDJSON events with --json", async () => {
    const { code, stdout, stderr } = await cli("-p", "swap", "--json");
    expect(code).toBe(3);
    expect(stderr).toBe("");
    expect(
      stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toMatchInlineSnapshot(`
      [
        {
          "chips": "Base · 1 tx · Native transfer · Staged",
          "icon": "send",
          "status": "success",
          "title": "Stage transaction",
          "type": "step",
        },
        {
          "chips": "Base · 1 tx",
          "icon": "simulate",
          "status": "success",
          "title": "Simulate transaction",
          "type": "step",
        },
        {
          "chips": "Base · 1 tx · Awaiting approval",
          "icon": "send",
          "status": "waiting",
          "title": "Commit transactions",
          "type": "step",
        },
        {
          "text": "Transfer is ready.",
          "thread": "thread-1",
          "type": "reply",
        },
        {
          "kind": "evm_tx",
          "ref": "7f3c",
          "signUrl": "https://chat.example/sign/7f3c",
          "state": "awaiting_approval",
          "type": "commit",
        },
      ]
    `);
  });
});

describe("sign-in", () => {
  it("is a guest with no sign-in, reusing the saved guest", async () => {
    state({
      thread: "thread-1",
      guest: { baseUrl: BASE, token: "guest-token" },
    });
    await cli("-p", "hi");
    expect(requests.find((r) => r.key === "POST /v1/agent/chat")?.auth).toBe(
      "Bearer guest-token",
    );
  });

  it("signs in with SIWE for --private-key and sends that session", async () => {
    const { code, stdout } = await cli("whoami", "--private-key", KEY);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Signed in  --private-key 0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
    expect(requests.map((r) => r.key)).toEqual([
      "POST /api/auth/siwe/nonce",
      "POST /api/auth/siwe/verify",
      "GET /v1/account",
    ]);
    expect(requests.at(-1)?.auth).toBe("Bearer session-token");
  });

  it("signs in with SIWS for --solana-private-key on --cluster", async () => {
    const address = SOLANA.publicKey.toBase58();
    const { code, stdout } = await cli(
      "whoami",
      "--solana-private-key",
      SOLANA_KEY,
      "--cluster",
      "devnet",
    );
    expect(code).toBe(0);
    expect(stdout).toContain(`Signed in  --solana-private-key ${address}`);
    expect(requests.map((r) => r.key)).toEqual([
      "POST /api/auth/siws/nonce",
      "POST /api/auth/siws/verify",
      "GET /v1/account",
    ]);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      walletAddress: address,
      chainId: "solana:devnet",
    });
    expect(requests.at(-1)?.auth).toBe("Bearer siws-token");
  });

  it("names both signers when the EVM key signs in", async () => {
    state({ svmKey: SOLANA_KEY });
    const { stdout } = await cli("whoami", "--private-key", KEY);
    expect(stdout).toContain(
      `Signed in  --private-key 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 · ${SOLANA.publicKey.toBase58()}`,
    );
  });

  it("uses the device grant from aomi login", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "grants.json"),
      JSON.stringify([
        {
          issuer: `${BASE}/api/auth`,
          clientId: "cli-1",
          accessToken: "device-token",
          expiresAt: Date.now() + 3_600_000,
          resource: `${BASE}/v1`,
          scopes: [
            "agent:read",
            "agent:write",
            "agent:actions:resolve",
            "offline_access",
          ],
        },
      ]),
    );
    const { code, stdout } = await cli("threads", "list");
    expect(code).toBe(0);
    expect(stdout).toContain("thread-1  Base swaps");
    expect(requests.find((r) => r.key === "GET /v1/agent/sessions")?.auth).toBe(
      "Bearer device-token",
    );
  });

});

describe("aomi rules", () => {
  const WALLET = "6f1c2b8e-0000-4000-8000-000000000001";
  const CHANGE = "9a000000-0000-4000-8000-000000000009";
  const change = {
    id: CHANGE,
    agent_wallet_id: WALLET,
    wallet_name: "Trading wallet",
    lines: [{ text: "USDC on Base: 200 → 400 a day", loosens: true }],
    state: "awaiting_admin",
    proposed_by: "agent:telegram:7712345678",
    expires_at: Math.floor(Date.now() / 1000) + 23 * 3600 + 600,
    signer: null,
    sign_message: null,
  };
  const body = {
    agent_wallet_id: WALLET,
    wallet_name: "Trading wallet",
    revision: 3,
    rules: { apps: null, limits: [], not_after: null, owner_only: true },
    sentences: ["Can use Jupiter, Kamino", "Up to 0.5 SOL a day on Solana"],
    admin: { kind: "aomi_managed" },
    stopped_until: null,
    usage: [
      {
        asset: "solana:mainnet-beta/native",
        used: "200000000",
        cap: "500000000",
        symbol: "SOL",
        decimals: 9,
      },
    ],
    window_ends_at: 1795046400,
    pending: change,
    enforced_by: ["aomi"],
    admin_wallets: [],
  };
  const paths = {
    wallets: "GET /v1/account/agent-wallets",
    rules: `GET /v1/account/agent-wallets/${WALLET}/rules`,
    change: `GET /v1/account/rule-changes/${CHANGE}`,
    approve: `POST /v1/account/rule-changes/${CHANGE}/approve`,
    decline: `POST /v1/account/rule-changes/${CHANGE}/decline`,
  };
  beforeEach(() => {
    const wallet = (id: string, archived_at: number | null) => ({
      id,
      name: "Trading wallet",
      paused: false,
      archived_at,
      app: null,
      last_used_at: null,
      created_at: 1,
      addresses: [],
      connections: [],
    });
    routes[paths.wallets] = {
      pause_all: false,
      wallets: [wallet(WALLET, null), wallet("archived", 5)],
    };
    routes[paths.rules] = body;
    routes[paths.change] = change;
    routes[paths.approve] = { ...body, pending: null, revision: 4 };
    routes[paths.decline] = { ...body, pending: null };
  });
  afterEach(() => {
    for (const key of Object.values(paths)) delete routes[key];
  });

  it("lists each agent wallet's sentences, use, admin and waiting change", async () => {
    const { code, stdout } = await cli("rules", "--private-key", KEY);
    expect(code).toBe(0);
    expect(stdout.split("\n")).toEqual([
      `Trading wallet  ${WALLET}`,
      "  Can use Jupiter, Kamino",
      "  Up to 0.5 SOL a day on Solana",
      "  used 0.2 / 0.5 SOL",
      "  Admin: Aomi-managed",
      `  Pending ${CHANGE} · 23 h left`,
      "    ↑ USDC on Base: 200 → 400 a day",
      "",
    ]);
    // Archived wallets have no rules to show.
    expect(requests.some((r) => r.key.includes("archived"))).toBe(false);
  });

  it("approves a change with the session it signed in with", async () => {
    const { code, stdout } = await cli(
      "rules",
      "approve",
      CHANGE,
      "--private-key",
      KEY,
    );
    expect(code).toBe(0);
    expect(stdout).toContain("Approved\nTrading wallet");
    expect(stdout).not.toContain("Pending");
    const sent = requests.find((r) => r.key === paths.approve);
    expect(sent).toMatchObject({ auth: "Bearer session-token", body: "{}" });
  });

  it("prints the page to sign on when the admin is a wallet", async () => {
    routes[paths.change] = {
      ...change,
      signer: { kind: "wallet", family: "evm", address: "0xAdmin" },
      sign_message: "Aomi rule change",
    };
    const { code, stdout } = await cli(
      "rules",
      "approve",
      CHANGE,
      "--private-key",
      KEY,
    );
    expect(code).toBe(3);
    expect(stdout).toContain(
      `Needs the signature of 0xAdmin. Sign at ${BASE}/rules/${CHANGE}`,
    );
    expect(requests.some((r) => r.key === paths.approve)).toBe(false);
  });

  it("declines a change, and refuses one that is no longer waiting", async () => {
    const declined = await cli("rules", "decline", CHANGE, "--private-key", KEY);
    expect(declined.code).toBe(0);
    expect(declined.stdout).toContain("Declined");
    routes[paths.change] = { ...change, state: "applied" };
    const late = await cli("rules", "approve", CHANGE, "--private-key", KEY);
    expect(late.code).toBe(1);
    expect(late.stderr).toContain(
      "This change isn't waiting for approval (applied)",
    );
  });
});
