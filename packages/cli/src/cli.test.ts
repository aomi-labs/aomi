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

// The local Solana key never reaches a node here: what it is asked to sign
// and to broadcast is only recorded.
const chain = vi.hoisted(() => {
  const asked = { signed: [] as unknown[], sent: [] as unknown[][] };
  return {
    ...asked,
    sign: async (input: unknown) => {
      asked.signed.push(input);
      return { signedTransaction: "c2lnbmVk" };
    },
    broadcast: async (...call: unknown[]) => {
      asked.sent.push(call);
      return "5igSent";
    },
  };
});
vi.mock("@aomi-labs/client/solana", async (original) => {
  const real = await original<typeof import("@aomi-labs/client/solana")>();
  return {
    ...real,
    solanaSigner: (...args: Parameters<typeof real.solanaSigner>) => ({
      ...real.solanaSigner(...args),
      signTransaction: chain.sign,
      broadcastTransaction: chain.broadcast,
    }),
  };
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
      const held = routes[key];
      // A route may answer from the request, or with its own response.
      const answer =
        typeof held === "function" ? held(requests.at(-1)!.body) : held;
      if (answer instanceof Response) return answer;
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
    [["policy"]],
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
  it.each(["session", "wallet", "app", "byok"])(
    "rejects retired command %s",
    async (name) => {
      expect((await cli(name)).code).toBe(2);
    },
  );

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

  it("says which key signed in, and that the other is only a local signer", async () => {
    state({ svmKey: SOLANA_KEY });
    const { stdout } = await cli("whoami", "--private-key", KEY);
    expect(stdout).toContain(
      `Signed in  --private-key 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 · local signer only: ${SOLANA.publicKey.toBase58()}\n`,
    );
    state({ evmKey: KEY });
    const solana = await cli("whoami", "--solana-private-key", SOLANA_KEY);
    expect(solana.stdout).toContain(
      `Signed in  --solana-private-key ${SOLANA.publicKey.toBase58()} · local signer only: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8\n`,
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

describe("aomi policy", () => {
  const WALLET = "6f1c2b8e-0000-4000-8000-000000000001";
  const CHANGE = "9a000000-0000-4000-8000-000000000009";
  const SOL = "solana:mainnet-beta/native";
  const USDC = "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const SOL_ID = `${SOL}@protocol:jupiter`;
  const USDC_ID = `${USDC}@any`;
  const UNTIL = Date.UTC(2099, 11, 11, 23, 59, 59) / 1000;
  const change = {
    id: CHANGE,
    agent_wallet_id: WALLET,
    wallet_name: "Trading wallet",
    lines: [{ text: "SOL on Jupiter: 0.5 → 2", loosens: true }],
    state: "awaiting_admin",
    proposed_by: "cli",
    expires_at: Math.floor(Date.now() / 1000) + 23 * 3600 + 600,
    signer: null,
    sign_message: null,
  };
  const sol = (amount = "500000000") => ({
    id: SOL_ID,
    asset: SOL,
    amount,
    to: { kind: "protocol", id: "jupiter" },
    active_until: UNTIL,
    symbol: "SOL",
    decimals: 9,
  });
  const usdc = {
    id: USDC_ID,
    asset: USDC,
    amount: "200000000",
    to: { kind: "any_protocol" },
    symbol: "USDC",
    decimals: 6,
  };
  const swig = (rule: string, state: string, ready = state !== "on") => ({
    rule,
    provider: "swig",
    name: "Swig",
    network: "solana:mainnet-beta",
    state,
    ready,
    left: null,
    expires_at: null,
    account: null,
    deployment_tx: null,
    note: null,
    signer: { family: "svm", address: null },
  });
  const body = {
    agent_wallet_id: WALLET,
    wallet_name: "Trading wallet",
    revision: 3,
    rules: { mode: "blacklist", rules: [sol(), usdc], linked_only: true },
    sentences: [],
    admin: { kind: "aomi_managed" },
    stopped_until: null,
    pending: null as object | null,
    enforced_by: { [SOL_ID]: ["Aomi", "Swig"], [USDC_ID]: ["Aomi"] },
    enforcement: [swig(SOL_ID, "on")],
    providers: [
      {
        provider: "swig",
        name: "Swig",
        network: "solana:mainnet-beta",
        holds: "total_period_and_destination",
        note: null,
      },
    ],
    admin_wallets: [{ kind: "wallet", family: "evm", address: "0xAdmin" }],
  };
  const paths = {
    wallets: "GET /v1/account/agent-wallets",
    rules: `GET /v1/account/agent-wallets/${WALLET}/policy`,
    write: `POST /v1/account/agent-wallets/${WALLET}/policy`,
    catalog: "GET /v1/account/policy/catalog",
    change: `GET /v1/account/policy-changes/${CHANGE}`,
    approve: `POST /v1/account/policy-changes/${CHANGE}/approve`,
    decline: `POST /v1/account/policy-changes/${CHANGE}/decline`,
  };
  const policy = (...argv: string[]) =>
    cli("policy", ...argv, "--private-key", KEY);
  const written = () =>
    requests
      .filter((request) => request.key === paths.write)
      .map((request) => JSON.parse(request.body));
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
    routes[paths.catalog] = {
      apps: [
        { id: "jupiter", label: "Jupiter", chains: ["solana:mainnet-beta"] },
        { id: "jito", label: "Jito", chains: ["solana:mainnet-beta"] },
        { id: "uniswap", label: "Uniswap", chains: ["eip155:8453"] },
      ],
      tokens: [
        { asset: SOL, symbol: "SOL", decimals: 9, chain: "Solana" },
        { asset: USDC, symbol: "USDC", decimals: 6, chain: "Base" },
        {
          asset: "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          decimals: 6,
          chain: "Ethereum",
        },
      ],
    };
    routes[paths.change] = change;
    routes[paths.approve] = { ...body, revision: 4 };
    routes[paths.decline] = body;
  });
  afterEach(() => {
    for (const key of Object.values(paths)) delete routes[key];
  });

  it("lists a wallet's mode, authority and a table of policies with where each stands on chain", async () => {
    const GONE = `${SOL}@protocol:jito`;
    routes[paths.rules] = {
      ...body,
      pending: change,
      enforcement: [swig(SOL_ID, "on"), swig(GONE, "on")],
    };
    const { code, stdout } = await policy();
    expect(code).toBe(0);
    expect(stdout.split("\n")).toEqual([
      `Trading wallet  ${WALLET}`,
      "  Mode: blacklist · Authority: self-approval",
      `  ${"ID".padEnd(USDC_ID.length)}  POLICY                             UNTIL           ON CHAIN`,
      `  ${SOL_ID.padEnd(USDC_ID.length)}  Up to 0.5 SOL on Jupiter (Solana)  2099-12-11 UTC  in sync (Swig)`,
      `  ${USDC_ID}  Up to 200 USDC on any app (Base)   always          Aomi only`,
      `  ${GONE.padEnd(USDC_ID.length)}  removed from Aomi                  -               on chain only`,
      "  Sends only to your linked wallets",
      `  Pending ${CHANGE} · 23 h left`,
      "    ↑ SOL on Jupiter: 0.5 → 2",
      `  On chain only: ${GONE}. Run aomi policy undeploy ${GONE}`,
      "",
    ]);
    // Archived wallets have no policies to show.
    expect(requests.some((r) => r.key.includes("archived"))).toBe(false);
  });

  it.each([
    ["off", "not deployed"],
    ["behind", "out of date (Swig)"],
    ["unverified", "not verified (Swig)"],
  ])("shows a provider's %s policy as %s", async (state, shown) => {
    routes[paths.rules] = { ...body, enforcement: [swig(SOL_ID, state)] };
    const { stdout } = await policy("list", "--wallet", WALLET);
    expect(stdout).toContain(`2099-12-11 UTC  ${shown}\n`);
    // --wallet reads that wallet only.
    expect(requests.some((r) => r.key === paths.wallets)).toBe(false);
  });

  it("does not call a policy in sync while its provider still asks the owner for something", async () => {
    const asks = { ...swig(SOL_ID, "on", true), next: "evm_transaction" };
    routes[paths.rules] = { ...body, enforcement: [asks] };
    const { stdout } = await policy("list");
    expect(stdout).toContain("2099-12-11 UTC  out of date (Swig)\n");
    expect(stdout).not.toContain("in sync");
  });

  it("prints the catalog, or one chain of it", async () => {
    const { stdout } = await policy("catalog", "--chain", "base");
    expect(stdout.split("\n")).toEqual([
      "APPS",
      "  ID       NAME     CHAINS",
      "  uniswap  Uniswap  eip155:8453",
      "TOKENS",
      "  SYMBOL  CHAIN  DECIMALS  ASSET",
      `  USDC    Base   6         ${USDC}`,
      "",
    ]);
    const none = await policy("catalog", "--chain", "tron");
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("chain: no chain tron in the catalog");
  });

  it("sets a policy from flags: merges it into the set it read, and says what changed and what is next", async () => {
    routes[paths.write] = {
      status: "waiting",
      rules: { ...body, pending: change },
    };
    const { code, stdout } = await policy(
      "set",
      "--amt",
      "2",
      "sol",
      "--to",
      "Jupiter",
      "--until",
      "2099-12-31",
    );
    // Filed and waiting for an approval, like any wait: exit 3.
    expect(code).toBe(3);
    expect(written()).toEqual([
      {
        rules: {
          mode: "blacklist",
          rules: [
            {
              asset: SOL,
              amount: "2000000000",
              to: { kind: "protocol", id: "jupiter" },
              active_until: Date.UTC(2099, 11, 31, 23, 59, 59) / 1000,
            },
            { asset: USDC, amount: "200000000", to: { kind: "any_protocol" } },
          ],
          linked_only: true,
        },
        // The revision the change was built from.
        revision: 3,
      },
    ]);
    expect(stdout.split("\n")).toEqual([
      "Up to 2 SOL on Jupiter (Solana), until 2099-12-31 UTC",
      "LOOSENS",
      "  FIELD   BEFORE          AFTER",
      "  amount  0.5 SOL         2 SOL",
      "  until   2099-12-11 UTC  2099-12-31 UTC",
      `Filed as ${CHANGE} · waiting for approval`,
      "Next",
      `  aomi policy approve ${CHANGE}   waiting for approval`,
      "",
    ]);
  });

  it("sets the same policy from JSON or a file, and says where a new one goes on chain", async () => {
    const SEND = `${SOL}@address:${SOLANA.publicKey.toBase58()}`;
    const added = {
      asset: SOL,
      amount: "0",
      to: { kind: "address", address: SOLANA.publicKey.toBase58() },
    };
    routes[paths.write] = {
      status: "applied",
      rules: {
        ...body,
        rules: { ...body.rules, rules: [sol(), usdc, { ...added, id: SEND }] },
        enforcement: [swig(SOL_ID, "on"), swig(SEND, "off")],
      },
    };
    const inline = await policy("set", JSON.stringify(added));
    expect(inline.stdout.split("\n")).toEqual([
      `No SOL to ${SOLANA.publicKey.toBase58().slice(0, 6)}…${SOLANA.publicKey.toBase58().slice(-4)} (Solana)`,
      "TIGHTENS",
      "  FIELD   BEFORE    AFTER",
      "  amount  no limit  0 SOL",
      "  until   -         always",
      "Applied",
      "Next",
      `  aomi policy deploy ${SEND}   not on chain yet; put it there`,
      "",
    ]);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "policy.json"), JSON.stringify(added));
    await policy("set", join(dir, "policy.json"));
    const [first, second] = written();
    expect(first.rules.rules).toHaveLength(3);
    expect(second).toEqual(first);
  });

  it("says a policy no provider can hold is enforced by Aomi only", async () => {
    routes[paths.write] = { status: "applied", rules: body };
    const { stdout } = await policy(
      "set",
      "--amt",
      "100",
      "USDC",
      "--to",
      "any",
      "--chain",
      "8453",
    );
    expect(stdout).toContain(
      "Next\n  Enforced by Aomi only: no on-chain provider holds this kind of policy\n",
    );
  });

  it.each([
    [
      ["--amt", "2", "SOL", "--to", "jupitr"],
      'to.id: no app "jupitr" on Solana. Nearest: jupiter',
    ],
    [
      ["--amt", "1.0000000001", "SOL", "--to", "jupiter"],
      "amount: 1.0000000001 is not an amount of SOL (9 decimals)",
    ],
    [
      ["--amt", "5", "USDC", "--to", "any"],
      "chain: USDC is on Base, Ethereum; name one",
    ],
    [["--amt", "5", "DOGE", "--to", "any"], "asset: no token DOGE"],
    [
      ["--amt", "5", "SOL", "--to", "any", "--until", "2099-02-30"],
      "until: must be a date, YYYY-MM-DD",
    ],
    [
      [JSON.stringify({ asset: SOL, amount: 5, to: { kind: "any_protocol" } })],
      "amount: must be a string of base units",
    ],
    [
      [JSON.stringify({ asset: SOL, amount: "5", to: { kind: "anywhere" } })],
      "to.kind: must be any_protocol, protocol or address",
    ],
    [
      [
        JSON.stringify({
          asset: SOL,
          amount: "5",
          to: { kind: "any_protocol" },
          active_until: 1,
        }),
      ],
      "active_until: must be in the future",
    ],
    [
      [JSON.stringify({ asset: SOL, amount: "5", daily: "1" })],
      "daily: not a policy field",
    ],
  ])(
    "refuses a bad policy naming its field, and sends nothing (%#)",
    async (argv, error) => {
      const { code, stderr } = await policy("set", ...argv);
      expect(code).toBe(2);
      expect(stderr).toContain(`error: ${error}`);
      expect(written()).toEqual([]);
    },
  );

  it("reads again and retries once when the policies moved under the write", async () => {
    let writes = 0;
    routes[paths.write] = () =>
      (writes += 1) === 1
        ? Response.json({ error: "rules_changed" }, { status: 409 })
        : { status: "applied", rules: body };
    const { code, stdout } = await policy(
      "set",
      "--amt",
      "0.1",
      "SOL",
      "--to",
      "jupiter",
    );
    expect(code).toBe(0);
    expect(stdout).toContain("TIGHTENS");
    expect(
      requests.map((r) => r.key).filter((key) => key.endsWith("/policy")),
    ).toEqual([paths.rules, paths.write, paths.rules, paths.write]);
    // A second refusal is not retried.
    writes = -5;
    routes[paths.write] = () =>
      Response.json({ error: "rules_changed" }, { status: 409 });
    const twice = await policy("set", "--amt", "0.1", "SOL", "--to", "jupiter");
    expect(twice.code).toBe(1);
    expect(twice.stderr).toContain("the policies changed: aomi policy");
    expect(written()).toHaveLength(4);
  });

  it("files and approves in one step with --yes when the authority is Aomi-managed", async () => {
    routes[paths.write] = {
      status: "waiting",
      rules: { ...body, pending: change },
    };
    routes[paths.approve] = {
      ...body,
      rules: { ...body.rules, rules: [sol("2000000000"), usdc] },
      enforcement: [swig(SOL_ID, "behind")],
    };
    const { code, stdout } = await policy(
      "set",
      "--amt",
      "2",
      "SOL",
      "--to",
      "jupiter",
      "--yes",
    );
    expect(code).toBe(0);
    expect(requests.at(-1)).toMatchObject({ key: paths.approve, body: "{}" });
    expect(stdout).toContain("LOOSENS");
    expect(stdout).toContain(
      `Applied\nNext\n  aomi policy deploy ${SOL_ID}   the chain holds an earlier version; replace it\n`,
    );
  });

  it("files only, and says --yes was not applied, when the authority is a wallet", async () => {
    const signer = { kind: "wallet", family: "evm", address: "0xAdmin" };
    routes[paths.write] = {
      status: "waiting",
      rules: { ...body, admin: signer, pending: { ...change, signer } },
    };
    const { code, stdout } = await policy(
      "set",
      "--amt",
      "2",
      "SOL",
      "--to",
      "jupiter",
      "--yes",
    );
    expect(code).toBe(3);
    expect(requests.some((r) => r.key === paths.approve)).toBe(false);
    expect(stdout).toContain(
      [
        `Filed as ${CHANGE} · waiting for approval`,
        "--yes was not applied: authority is wallet 0xAdmin, which must sign",
        "Next",
        `  Sign at ${BASE}/policy/${CHANGE}   0xAdmin must sign`,
      ].join("\n"),
    );
  });

  it("removes a policy and says what the chain still holds", async () => {
    routes[paths.write] = {
      status: "applied",
      rules: { ...body, rules: { ...body.rules, rules: [usdc] } },
    };
    const { code, stdout } = await policy("remove", SOL_ID);
    expect(code).toBe(0);
    expect(written()[0].rules.rules).toEqual([
      { asset: USDC, amount: "200000000", to: { kind: "any_protocol" } },
    ]);
    expect(stdout.split("\n")).toEqual([
      "Remove: Up to 0.5 SOL on Jupiter (Solana)",
      "TIGHTENS",
      "  FIELD   BEFORE   AFTER",
      "  amount  0.5 SOL  no limit",
      "Applied",
      "Next",
      `  Still on chain: Swig holds ${SOL_ID}. Run aomi policy undeploy ${SOL_ID}`,
      "",
    ]);
    const missing = await policy("remove", "nope");
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("No policy nope on this wallet");
    expect(written()).toHaveLength(1);
  });

  it("changes the mode and the authority through the same change call", async () => {
    routes[paths.write] = { status: "applied", rules: body };
    const strict = await policy("mode", "whitelist");
    expect(strict.stdout).toContain(
      "TIGHTENS\n  FIELD  BEFORE     AFTER\n  mode   blacklist  whitelist\nApplied",
    );
    await policy("authority", "0xadmin");
    expect(written()).toEqual([
      { rules: { ...written()[0].rules, mode: "whitelist" }, revision: 3 },
      {
        admin: { kind: "wallet", family: "evm", address: "0xAdmin" },
        revision: 3,
      },
    ]);
    expect((await policy("mode", "open")).code).toBe(2);
    const stranger = await policy("authority", "0xNobody");
    expect(stranger.stderr).toContain(
      "authority: 0xNobody is not a wallet linked to this account: 0xAdmin",
    );
  });

  it("approves a change with the session it signed in with, then names what to deploy", async () => {
    routes[paths.approve] = { ...body, enforcement: [swig(SOL_ID, "off")] };
    const { code, stdout } = await policy("approve", CHANGE);
    expect(code).toBe(0);
    expect(stdout).toContain("Approved\nTrading wallet");
    // The change named the wallet, so the command to run next names it too.
    expect(stdout).toContain(
      `Next\n  aomi policy deploy ${SOL_ID} --wallet ${WALLET}   not on chain yet; put it there\n`,
    );
    const sent = requests.find((r) => r.key === paths.approve);
    expect(sent).toMatchObject({ auth: "Bearer session-token", body: "{}" });
  });

  it("prints the page to sign on when the authority is a wallet", async () => {
    routes[paths.change] = {
      ...change,
      signer: { kind: "wallet", family: "evm", address: "0xAdmin" },
      sign_message: "Aomi rule change",
    };
    const { code, stdout } = await policy("approve", CHANGE);
    expect(code).toBe(3);
    expect(stdout).toContain(
      `Needs the signature of 0xAdmin. Sign at ${BASE}/policy/${CHANGE}`,
    );
    expect(requests.some((r) => r.key === paths.approve)).toBe(false);
  });

  it("declines a change, and refuses one that is no longer waiting", async () => {
    const declined = await policy("decline", CHANGE);
    expect(declined.code).toBe(0);
    expect(declined.stdout).toContain("Declined");
    routes[paths.change] = { ...change, state: "applied" };
    const late = await policy("approve", CHANGE);
    expect(late.code).toBe(1);
    expect(late.stderr).toContain(
      "This change isn't waiting for approval (applied)",
    );
  });

  it.each(["approve", "decline"])(
    "refuses to %s a change of another wallet than --wallet",
    async (verb) => {
      const OTHER = "6f1c2b8e-0000-4000-8000-000000000002";
      const { code, stderr } = await policy(verb, CHANGE, "--wallet", OTHER);
      expect(code).toBe(1);
      expect(stderr).toContain(
        `error: Change ${CHANGE} is for wallet ${WALLET}, not ${OTHER}. Nothing was decided`,
      );
      expect(requests.some((r) => r.key.endsWith(`/${verb}`))).toBe(false);
      expect((await policy(verb, CHANGE, "--wallet", WALLET)).code).toBe(0);
    },
  );

  it("names --wallet in the commands to run next when the wallet was named", async () => {
    const GONE = `${SOL}@protocol:jito`;
    routes[paths.write] = {
      status: "applied",
      rules: {
        ...body,
        rules: { ...body.rules, rules: [usdc] },
        enforcement: [swig(SOL_ID, "on"), swig(GONE, "on")],
      },
    };
    const removed = await policy("remove", SOL_ID, "--wallet", WALLET);
    expect(removed.stdout).toContain(
      `  Still on chain: Swig holds ${SOL_ID}. Run aomi policy undeploy ${SOL_ID} --wallet ${WALLET}\n`,
    );
    routes[paths.write] = {
      status: "applied",
      rules: { ...body, enforcement: [swig(SOL_ID, "behind")] },
    };
    const set = await policy(
      ...["set", "--amt", "0.1", "SOL", "--to", "jupiter"],
      ...["--wallet", WALLET],
    );
    expect(set.stdout).toContain(
      `  aomi policy deploy ${SOL_ID} --wallet ${WALLET}   the chain holds an earlier version; replace it\n`,
    );
    routes[paths.rules] = {
      ...body,
      enforcement: [swig(SOL_ID, "on"), swig(GONE, "on")],
    };
    const listed = await policy("list", "--wallet", WALLET);
    expect(listed.stdout).toContain(
      `  On chain only: ${GONE}. Run aomi policy undeploy ${GONE} --wallet ${WALLET}\n`,
    );
  });

  it("takes the server's word on whether anything changed, not the rows it shows", async () => {
    // The same amount and end as held, and the server still applied a change.
    routes[paths.write] = { status: "applied", rules: body };
    const same = ["set", "--amt", "0.5", "SOL", "--to", "jupiter"];
    const applied = await policy(...same, "--until", "2099-12-11");
    expect(applied.stdout.split("\n")).toEqual([
      "Up to 0.5 SOL on Jupiter (Solana), until 2099-12-11 UTC",
      "TIGHTENS",
      "Applied",
      "Next",
      "  Nothing: Aomi and the chain agree",
      "",
    ]);
    routes[paths.write] = {
      status: "waiting",
      rules: { ...body, pending: change },
    };
    const waiting = await policy(...same, "--until", "2099-12-11");
    expect(waiting.code).toBe(3);
    expect(waiting.stdout).toContain(
      `LOOSENS\nFiled as ${CHANGE} · waiting for approval\n`,
    );
    // Rows that differ do not make a change the server says it did not make.
    routes[paths.write] = { status: "unchanged", rules: body };
    const unchanged = await policy(
      "set",
      "--amt",
      "2",
      "SOL",
      "--to",
      "jupiter",
    );
    expect(unchanged.code).toBe(0);
    expect(unchanged.stdout).toContain("No change\nNext\n");
    expect(unchanged.stdout).not.toContain("FIELD");
  });

  it("removes the policy the prefix named first, or nothing, when the policies moved under the write", async () => {
    const JITO = { ...sol(), id: `${SOL}@protocol:jito` };
    let reads = 0;
    // Jupiter is gone by the second read, and the same prefix now names Jito.
    routes[paths.rules] = () =>
      (reads += 1) === 1
        ? body
        : {
            ...body,
            revision: 4,
            rules: { ...body.rules, rules: [JITO] },
            enforcement: [],
          };
    routes[paths.write] = () =>
      Response.json({ error: "rules_changed" }, { status: 409 });
    const { code, stderr } = await policy("remove", `${SOL}@protocol:j`);
    expect(code).toBe(1);
    expect(stderr).toContain(`error: No policy ${SOL_ID} on this wallet`);
    expect(reads).toBe(2);
    expect(written()).toHaveLength(1);
  });

  it("matches a Solana authority address exactly, and an EVM one in either case", async () => {
    const OWNER = SOLANA.publicKey.toBase58();
    routes[paths.rules] = {
      ...body,
      admin_wallets: [
        { kind: "wallet", family: "svm", address: OWNER },
        ...body.admin_wallets,
      ],
    };
    routes[paths.write] = { status: "applied", rules: body };
    const other = await policy("authority", OWNER.toLowerCase());
    expect(other.code).toBe(1);
    expect(other.stderr).toContain(
      `authority: ${OWNER.toLowerCase()} is not a wallet linked to this account`,
    );
    expect(written()).toEqual([]);
    expect((await policy("authority", OWNER)).code).toBe(0);
    expect((await policy("authority", "0xADMIN")).code).toBe(0);
    expect(written().map((sent) => sent.admin.address)).toEqual([
      OWNER,
      "0xAdmin",
    ]);
  });

  describe("deploy and undeploy", () => {
    const OWNER = SOLANA.publicKey.toBase58();
    const GONE = `${SOL}@protocol:jito`;
    const steps = {
      prepare: `POST /v1/account/agent-wallets/${WALLET}/policy/enforcement/swig/prepare`,
      confirm: `POST /v1/account/agent-wallets/${WALLET}/policy/enforcement/swig/confirm`,
    };
    const owned = (rule: string, state: string) => ({
      ...swig(rule, state),
      signer: { family: "svm", address: OWNER },
    });
    const run = (...argv: string[]) =>
      cli("policy", ...argv, "--solana-private-key", SOLANA_KEY);
    const sent = (step: keyof typeof steps) =>
      requests
        .filter((request) => request.key === steps[step])
        .map((request) => JSON.parse(request.body));
    const owns = "GET /v1/account/wallets";
    beforeEach(() => {
      chain.signed.length = 0;
      chain.sent.length = 0;
      routes[owns] = {
        wallets: [
          {
            id: "w_1",
            kind: "browser",
            family: "svm",
            address: OWNER,
            label: "Phantom",
          },
        ],
      };
      routes[paths.rules] = { ...body, enforcement: [swig(SOL_ID, "off")] };
      routes[steps.prepare] = {
        action: {
          kind: "transaction",
          network: "solana:mainnet-beta",
          unsigned_base64: "dW5zaWduZWQ=",
        },
      };
      routes[steps.confirm] = { rules: body };
    });
    afterEach(() => {
      for (const key of [...Object.values(steps), owns]) delete routes[key];
    });

    it("deploys with the local signer: the checks, the three steps, then where it stands", async () => {
      const { code, stdout } = await run("deploy", SOL_ID, "--yes");
      expect(code).toBe(0);
      expect(stdout.split("\n")).toEqual([
        "Deploy: Up to 0.5 SOL on Jupiter (Solana)",
        "  provider     Swig on solana:mainnet-beta",
        `  signer       ${OWNER} (local key) will own it on chain`,
        "  action       Solana transaction",
        "  prepare      ready to sign",
        "  sign + send  sent 5igSent",
        "  confirm      Aomi read the chain",
        "On chain: in sync (Swig)",
        "Next",
        "  Nothing: Aomi and the chain agree",
        "",
      ]);
      const request = {
        network: "solana:mainnet-beta",
        rule: SOL_ID,
        revision: 3,
        owner: OWNER,
      };
      expect(sent("prepare")).toEqual([request]);
      expect(sent("confirm")).toEqual([request]);
      expect(chain.signed).toEqual([
        { transactionBase64: "dW5zaWduZWQ=", cluster: "solana:mainnet" },
      ]);
      expect(chain.sent).toEqual([["c2lnbmVk", "solana:mainnet"]]);
    });

    it("asks before signing, and signs nothing without an answer", async () => {
      const { code, stderr } = await run("deploy", SOL_ID);
      expect(code).toBe(2);
      expect(stderr).toContain("Pass --yes outside a terminal");
      expect(sent("prepare")).toEqual([]);
      expect(chain.signed).toEqual([]);
    });

    it("takes a policy Aomi no longer holds off the chain", async () => {
      routes[paths.rules] = { ...body, enforcement: [owned(GONE, "on")] };
      const { code, stdout } = await run("undeploy", GONE, "--yes");
      expect(code).toBe(0);
      expect(stdout).toContain(`Undeploy: ${GONE}\n`);
      expect(stdout).toContain("(local key) owns this policy");
      expect(stdout).toContain("On chain: nothing\n");
      expect(sent("prepare")).toEqual([
        {
          network: "solana:mainnet-beta",
          rule: GONE,
          revision: 3,
          owner: OWNER,
          remove: true,
        },
      ]);
      expect(chain.sent).toHaveLength(1);
    });

    it("stops when Aomi asks for another action than the one confirmed", async () => {
      routes[steps.prepare] = {
        action: {
          kind: "typed_data",
          network: "solana:mainnet-beta",
          typed_data: { domain: {}, types: {}, primaryType: "X", message: {} },
        },
      };
      const { code, stderr } = await run("deploy", SOL_ID, "--yes");
      expect(code).toBe(1);
      expect(stderr).toContain("Nothing was signed");
      expect(sent("confirm")).toEqual([]);
    });

    it.each([
      [
        "a policy its provider holds in whitelist mode only",
        ["deploy", SOL_ID],
        { enforcement: [] },
        1,
        "Swig holds policies only in whitelist mode, and this wallet is in blacklist mode: aomi policy mode whitelist",
      ],
      [
        "a local key that is not one of the account's wallets, before it asks",
        ["deploy", SOL_ID],
        { wallets: [] },
        3,
        `The local signer ${OWNER} is not one of this account's wallets, so it cannot own this policy. Sign in with it (--solana-private-key without --private-key) or link it to this account at ${BASE}. Nothing was signed`,
      ],
      [
        "a policy Aomi no longer holds",
        ["deploy", GONE],
        { enforcement: [owned(GONE, "on")] },
        1,
        `Aomi no longer holds ${GONE}. To take it off the chain: aomi policy undeploy ${GONE}`,
      ],
      [
        "a policy no provider can hold",
        ["deploy", USDC_ID],
        {},
        1,
        "No on-chain provider can hold this policy. Aomi checks it on every commit",
      ],
      [
        "a provider that declines, with its reason",
        ["deploy", SOL_ID],
        {
          enforcement: [
            { ...swig(SOL_ID, "off", false), note: "Too many apps." },
          ],
        },
        1,
        "No on-chain provider can hold this policy (Too many apps.)",
      ],
      [
        "a signer that is not the owner",
        ["deploy", SOL_ID],
        {
          enforcement: [
            {
              ...swig(SOL_ID, "behind"),
              signer: { family: "svm", address: "SomeoneElse1111" },
            },
          ],
        },
        1,
        `The local signer ${OWNER} is not SomeoneElse1111, the wallet that owns this policy. Nothing was signed`,
      ],
      [
        "an unknown policy",
        ["deploy", "nope"],
        {},
        1,
        "No policy nope on this wallet or on chain",
      ],
      [
        "an undeploy with nothing on chain",
        ["undeploy", SOL_ID],
        {},
        1,
        `Nothing on chain for ${SOL_ID}`,
      ],
      [
        "an unknown provider",
        ["deploy", SOL_ID, "--provider", "metamask"],
        {},
        1,
        "No provider metamask on this wallet: swig",
      ],
    ])("refuses %s", async (_, argv, { wallets, ...held }, exit, error) => {
      if (wallets) routes[owns] = { wallets };
      routes[paths.rules] = { ...(routes[paths.rules] as object), ...held };
      const { code, stderr } = await run(...argv, "--yes");
      expect(code).toBe(exit);
      expect(stderr).toContain(`error: ${error}`);
      expect(sent("prepare")).toEqual([]);
      expect(chain.signed).toEqual([]);
    });

    it("prints where to deploy and exits 3 when no local key is the owner's kind", async () => {
      // An EVM key only: the Solana owner is an embedded wallet.
      const { code, stderr } = await policy("deploy", SOL_ID, "--yes");
      expect(code).toBe(3);
      expect(stderr).toContain(
        `No local Solana key for the wallet that owns this policy: aomi wallets signer set, or deploy it at ${BASE}/?settings=policies&wallet=${WALLET}&policy=${encodeURIComponent(SOL_ID)}\n`,
      );
      expect(sent("prepare")).toEqual([]);
    });

    it("takes a prefix only one policy id starts with, and lists the ids an ambiguous one matches", async () => {
      const { code, stdout } = await run("deploy", "solana:", "--yes");
      expect(code).toBe(0);
      expect(stdout).toContain("Deploy: Up to 0.5 SOL on Jupiter (Solana)\n");
      expect(sent("prepare")).toMatchObject([{ rule: SOL_ID }]);
      routes[paths.rules] = {
        ...body,
        enforcement: [swig(SOL_ID, "off"), owned(GONE, "on")],
      };
      const both = await run("undeploy", `${SOL}@protocol:j`, "--yes");
      expect(both.code).toBe(1);
      expect(both.stderr).toContain(
        `error: ${SOL}@protocol:j matches 2 policies: ${SOL_ID}, ${GONE}`,
      );
      expect(sent("prepare")).toHaveLength(1);
    });

    it("follows the entry's next: no wallet action needs no local key, and an action that shows up is refused", async () => {
      // An EVM key only, and the chain needs nothing from the Solana owner.
      routes[paths.rules] = {
        ...body,
        enforcement: [{ ...owned(GONE, "behind"), next: null }],
      };
      delete routes[steps.prepare];
      routes[steps.prepare] = { action: null };
      const { code, stdout } = await policy("undeploy", GONE, "--yes");
      expect(code).toBe(0);
      expect(stdout).toContain(`  signer       ${OWNER} owns this policy\n`);
      expect(stdout).toContain(
        "  action       none; Aomi only reads the chain\n",
      );
      expect(stdout).toContain("  sign + send  nothing to sign\n");
      expect(sent("confirm")).toHaveLength(1);
      routes[steps.prepare] = {
        action: {
          kind: "transaction",
          network: "solana:mainnet-beta",
          unsigned_base64: "dW5zaWduZWQ=",
        },
      };
      const surprised = await policy("undeploy", GONE, "--yes");
      expect(surprised.code).toBe(1);
      expect(surprised.stderr).toContain("Nothing was signed");
      expect(sent("confirm")).toHaveLength(1);
      expect(chain.signed).toEqual([]);
    });

    it("reads the status after a deploy from the provider it named", async () => {
      const other = (state: string) => ({
        ...swig(SOL_ID, state),
        provider: "other",
        name: "Other",
      });
      routes[paths.rules] = {
        ...body,
        enforcement: [other("on"), swig(SOL_ID, "off")],
      };
      routes[steps.confirm] = {
        rules: { ...body, enforcement: [other("on"), swig(SOL_ID, "behind")] },
      };
      const argv = ["deploy", SOL_ID, "--provider", "swig", "--yes"];
      const { stdout } = await run(...argv);
      expect(stdout).toContain("On chain: out of date (Swig)\n");
      const { stdout: asJson } = await run(...argv, "--json");
      expect(JSON.parse(asJson)).toMatchObject({ on_chain: "out_of_date" });
    });

    it("names the transaction it sent when Aomi's node never shows it, and exits without an error", async () => {
      routes[steps.confirm] = () =>
        Response.json({ error: "chain_not_settled" }, { status: 409 });
      const unsettled = async (...argv: string[]) => {
        requests = [];
        const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
          wake: () => void,
        ) => {
          queueMicrotask(wake);
          return 0;
        }) as never);
        try {
          return await run("deploy", SOL_ID, "--yes", ...argv);
        } finally {
          timer.mockRestore();
        }
      };
      const { code, stdout } = await unsettled();
      expect(code).toBe(0);
      expect(stdout).toContain(
        [
          "  sign + send  sent 5igSent",
          "  confirm      not on Aomi's node yet",
          "On chain: not deployed",
          "Next",
          "  aomi policy list   5igSent was sent; check again before sending anything more",
          "",
        ].join("\n"),
      );
      // The same retry limit as before, then one read of where it stands.
      expect(sent("confirm")).toHaveLength(6);
      expect(requests.at(-1)!.key).toBe(paths.rules);
      expect(chain.sent).toHaveLength(1);
      const asJson = await unsettled("--json");
      expect(JSON.parse(asJson.stdout)).toMatchObject({
        settled: false,
        transaction: "5igSent",
        on_chain: "not_deployed",
      });
    });

    it("gives the same guidance when the prepare step says the owner is not the account's", async () => {
      routes[steps.prepare] = () =>
        Response.json(
          {
            error: "account_not_found",
            message:
              "The on-chain address does not belong to this Aomi account",
          },
          { status: 404 },
        );
      const { code, stderr } = await run("deploy", SOL_ID, "--yes");
      expect(code).toBe(3);
      expect(stderr).toContain(
        `error: The local signer ${OWNER} is not one of this account's wallets`,
      );
      expect(chain.signed).toEqual([]);
    });

    it("keeps the transaction in --json when what follows the send fails", async () => {
      routes[steps.confirm] = () =>
        Response.json({ error: "rules_changed" }, { status: 409 });
      const { code, stdout, stderr } = await run(
        "deploy",
        SOL_ID,
        "--yes",
        "--json",
      );
      expect(code).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        error: { code: "rules_changed", transaction: "5igSent" },
      });
      expect(stderr).toContain("error: ");
      expect(chain.sent).toHaveLength(1);
    });

    it("says a policy already in sync has nothing to deploy", async () => {
      routes[paths.rules] = body;
      const { code, stdout } = await run("deploy", SOL_ID, "--yes");
      expect(code).toBe(0);
      expect(stdout).toBe("Already in sync (Swig)\n");
      expect(sent("prepare")).toEqual([]);
    });
  });

  it("says a policy waits for whitelist mode where a provider on its chain holds only that", async () => {
    const held = { ...body, enforcement: [] };
    routes[paths.rules] = held;
    routes[paths.write] = { status: "applied", rules: held };
    const set = await policy("set", "--amt", "0.01", "SOL", "--to", "jupiter");
    expect(set.stdout).toContain(
      "Next\n  aomi policy mode whitelist   on-chain providers hold policies only in whitelist mode\n",
    );
    const { stdout } = await policy("list");
    expect(stdout).toMatch(/SOL on Jupiter .* needs whitelist mode\n/);
    // No provider serves Base here: that one is Aomi's alone.
    expect(stdout).toMatch(/USDC on any app .* Aomi only\n/);
    // A change that still waits is not held yet: the same reason applies.
    routes[paths.rules] = { ...held, rules: { ...body.rules, rules: [usdc] } };
    routes[paths.write] = {
      status: "waiting",
      rules: {
        ...held,
        rules: { ...body.rules, rules: [usdc] },
        pending: change,
      },
    };
    const waiting = await policy("set", "--amt", "1", "SOL", "--to", "jupiter");
    expect(waiting.stdout).toContain(
      "  aomi policy mode whitelist   on-chain providers hold policies only in whitelist mode\n",
    );
    expect(waiting.stdout).not.toContain("put it there");
  });

  it("no longer knows aomi rules", async () => {
    expect((await cli("rules")).code).toBe(2);
  });
});
