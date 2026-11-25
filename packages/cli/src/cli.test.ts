// @vitest-environment node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Connection, Keypair } from "@solana/web3.js";
import { SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { encodeFunctionData, erc20Abi, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dir = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/aomi-cli-test-${process.pid}`;
  process.env.AOMI_STATE_DIR = path;
  return path;
});

import { main, rootHelp } from "./app";
import { signsWith } from "./commands/wallets";

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

let requests: {
  key: string;
  url: string;
  auth: string | null;
  body: string;
}[] = [];
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
      const key = `${request.method} ${new URL(request.url).pathname.replace(/^\/stack/, "")}`;
      requests.push({
        key,
        url: request.url,
        auth: request.headers.get("authorization"),
        body: await request.text(),
      });
      // A list answers in order, its last entry from then on.
      const listed = routes[key];
      const answer =
        typeof listed === "function"
          ? listed(requests.at(-1)!.body)
          : Array.isArray(listed) && listed.length > 1
            ? listed.shift()
            : listed;
      if (answer instanceof Response) return answer;
      if (key === "POST /api/auth/siwe/verify")
        return Response.json(answer, {
          headers: { "set-auth-token": "session-token" },
        });
      return answer === undefined
        ? Response.json({ error: `unexpected ${key}` }, { status: 500 })
        : Response.json(Array.isArray(answer) ? answer[0] : answer);
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
    [["pipeline", "stage"]],
    [["build"]],
  ])("prints %j --help", async (route) => {
    const { code, stdout } = await cli(...route, "--help");
    expect(code).toBe(0);
    expect(stdout).toMatchSnapshot();
  });

  it.each([
    [[]],
    [["pipeline"]],
    [["pipeline", "ops"]],
    [["pipeline", "package"]],
    [["library"]],
    [["build"]],
    [["build", "publish"]],
    [["build", "rollback"]],
  ])("%j --help names no retired word", async (route) => {
    const { code, stdout } = await cli(...route, "--help");
    expect(code).toBe(0);
    expect(stdout).not.toMatch(
      /\b(?:toolsets?|plugins?|namespaces?|apps?|skills?)\b/i,
    );
  });

  it("shows hidden flags under --help-all only", async () => {
    expect((await cli("chat", "--help")).stdout).not.toContain("--backend-url");
    expect((await cli("chat", "--help-all")).stdout).toContain("--backend-url");
  });
});

describe("command validation", () => {
  it.each([
    "session",
    "wallet",
    "toolset",
    "byok",
    "packages",
    "publish",
    "promote",
    "rollback",
    "releases",
    "codes",
  ])("rejects retired command %s", async (name) => {
    expect((await cli(name)).code).toBe(2);
  });

  it("names pipeline stage, not pipeline build", async () => {
    expect((await cli("pipeline", "build", "op")).code).toBe(2);
  });

  it("has no pipeline agents directory", async () => {
    expect((await cli("pipeline", "agents")).code).toBe(2);
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

describe("aomi pipeline", () => {
  const AGENT = "agent=acme%2Fprices";
  const operation = "/v1/pipeline/packages/acme%2Ffeeds/operations/stage_quote";
  const build = {
    version: 2,
    status: "simulated",
    actions: [],
    origin: { agent: "acme/prices", packages: ["acme/feeds"], operations: [] },
    simulation: {
      status: "passed",
      balanceChanges: [],
      approvals: [],
      warnings: [],
      fees: [],
      guards: [],
      gas: null,
      logs: [],
    },
    expiresAt: at,
    digest: "sha256:quote",
    attestation: "a",
  };

  beforeEach(() => {
    state({ guest: { baseUrl: BASE, token: "guest-token" } });
    routes[`GET ${operation}`] = {
      kind: "operation",
      name: "stage_quote",
      method: "POST",
      href: `${operation}?${AGENT}`,
      chainFamily: "evm",
      inputSchema: { type: "object" },
    };
    routes["GET /v1/pipeline/packages/acme%2Ffeeds/operations"] = {
      kind: "directory",
      path: "/v1/pipeline/packages/acme%2Ffeeds/operations",
      entries: [{ name: "stage_quote", kind: "operation", href: "" }],
    };
    routes["POST /v1/pipeline/evm/build"] = build;
  });
  afterEach(() => {
    for (const key of Object.keys(routes))
      if (key.includes("/v1/pipeline")) delete routes[key];
  });

  it("lists one package's operations for the named agent", async () => {
    const { code, stdout } = await cli(
      "pipeline",
      "ops",
      "--agent",
      "acme/prices",
      "--package",
      "acme/feeds",
    );
    expect(code).toBe(0);
    expect(stdout).toBe("stage_quote\n");
    expect(requests.at(-1)?.url).toBe(
      `${BASE}/v1/pipeline/packages/acme%2Ffeeds/operations?${AGENT}`,
    );
  });

  it("stages the described operation as the named agent", async () => {
    const { code, stdout } = await cli(
      "pipeline",
      "stage",
      "stage_quote",
      "{}",
      "--agent",
      "acme/prices",
      "--package",
      "acme/feeds",
    );
    expect(code).toBe(0);
    expect(stdout).toContain("Build sha256:quote  evm");
    const pipeline = requests.filter((r) => r.key.includes("/v1/pipeline"));
    expect(pipeline.map((r) => r.url)).toEqual([
      `${BASE}${operation}?${AGENT}`,
      `${BASE}/v1/pipeline/evm/build?${AGENT}`,
    ]);
    expect(JSON.parse(pipeline[1]!.body)).toEqual({
      packages: ["acme/feeds"],
      operation,
      arguments: {},
    });
  });

  it("uses the main agent when none is named", async () => {
    routes["GET /v1/pipeline/operations"] = {
      kind: "directory",
      path: "/v1/pipeline/operations",
      entries: [],
    };
    expect((await cli("pipeline", "ops")).code).toBe(0);
    expect(requests.at(-1)?.url).toBe(`${BASE}/v1/pipeline/operations`);
  });
});

describe("aomi tx", () => {
  const ref = "9a1b";
  const ME = privateKeyToAccount(KEY).address;
  const SPENDER = "0x00000000000000000000000000000000000000bb";
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const LIVE = "https://aomi.chat";
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [SPENDER, 2n ** 256n - 1n],
  });
  const leg = (calldata: string) => ({
    chain_id: 8453,
    from: ME,
    to: USDC,
    data: calldata,
    label: "Deposit\npool.deposit(amount: 2000000)",
    kind: "call",
  });
  const waiting = {
    ...view(ref, "needs_signature"),
    signer: ME,
    broadcaster: "wallet",
    sign_url: `${BASE}/sign/${ref}`,
    origin: "cli",
    origin_agent_id: null,
    initiator: "turn",
    review: {
      digest: "sha256:review",
      request: {
        type: "execute_evm",
        transactions: [leg(data)],
        simulation: {
          status: "passed",
          balanceChanges: [],
          approvals: [
            {
              account: ME,
              spender: SPENDER,
              asset: USDC,
              kind: "allowance",
              standard: "erc20",
              unlimited: true,
              symbol: "USDC",
              decimals: 6,
            },
          ],
          fees: [],
          warnings: [],
          guards: [],
          gas: { units: "50000" },
          logs: [],
        },
      },
    },
    action: {
      kind: "sign",
      payload: {
        kind: "evm_transaction",
        chain_id: 8453,
        nonce: 1,
        signer: ME,
        transaction: {
          to: USDC,
          data,
          value: "0",
          gas_limit: 50000,
          max_fee_per_gas: "1",
          max_priority_fee_per_gas: "1",
        },
      },
    },
  };
  const solana = new Transaction({
    feePayer: SOLANA.publicKey,
    blockhash: SOLANA.publicKey.toBase58(),
    lastValidBlockHeight: 1,
  }).add(
    SystemProgram.transfer({
      fromPubkey: SOLANA.publicKey,
      toPubkey: SOLANA.publicKey,
      lamports: 5,
    }),
  );
  const [ix] = solana.instructions;
  const svm = {
    ...waiting,
    chain_family: "svm",
    chain_ref: "mainnet-beta",
    signer: SOLANA.publicKey.toBase58(),
    review: {
      digest: "d",
      request: {
        type: "execute_svm",
        transactions: [
          {
            payer: SOLANA.publicKey.toBase58(),
            cluster: "mainnet-beta",
            version: "legacy",
            description: "Send",
            kind: "transfer",
            instructions: [
              {
                payer: SOLANA.publicKey.toBase58(),
                cluster: "mainnet-beta",
                program_id: ix!.programId.toBase58(),
                accounts: ix!.keys.map((key) => ({
                  pubkey: key.pubkey.toBase58(),
                  is_signer: key.isSigner,
                  is_writable: key.isWritable,
                })),
                data_base64: ix!.data.toString("base64"),
                description: "Send",
                kind: "transfer",
              },
            ],
          },
        ],
        simulation: {
          ...waiting.review.request.simulation,
          approvals: [],
          fees: [{ asset: "native", amount: "5000" }],
        },
      },
    },
    action: {
      kind: "sign",
      payload: {
        kind: "svm_transaction",
        signer: SOLANA.publicKey.toBase58(),
        transaction_base64: solana
          .serialize({ requireAllSignatures: false })
          .toString("base64"),
      },
    },
  };
  /** Aomi sends it, so only Solana's fee is known before. */
  const parked = {
    ...svm,
    state: "awaiting_approval",
    broadcaster: "hosted",
    action: null,
  };
  const yes = ["--yes", "--version", "1"];
  const tx = (verb: string, ...more: string[]) =>
    cli("tx", verb, ref, "--private-key", KEY, ...more);
  const live = (...more: string[]) =>
    tx("sign", ...yes, "--backend-url", LIVE, ...more);
  const wrote = () =>
    requests.filter((r) => r.key.startsWith(`POST /v1/commits/${ref}/`));
  /** The RPC at "/": its chain, then what it does with signed bytes. */
  const rpc =
    (chain: string, send: () => object = () => ({ result: null })) =>
    (body: string) =>
      body.includes("eth_chainId")
        ? { jsonrpc: "2.0", id: 1, result: chain }
        : { jsonrpc: "2.0", id: 1, ...send() };
  /** A signature's answer: what was signed, to send. */
  const signed = (body: string) => {
    const [payload] = JSON.parse(body).payloads;
    return {
      ...waiting,
      version: 2,
      state: "awaiting_broadcast",
      action: {
        kind: "broadcast",
        signed_transaction: payload,
        transaction_id: keccak256(payload),
      },
    };
  };
  const confirmed = {
    ...waiting,
    version: 3,
    state: "confirmed",
    action: null,
    transaction_id: "0xhash",
  };
  beforeEach(() => {
    routes[`GET /v1/commits/${ref}`] = waiting;
    routes["POST /"] = rpc("0x2105");
  });
  afterEach(() => {
    delete routes["POST /"];
    delete routes["POST /s3cret"];
    for (const key of Object.keys(routes))
      if (key.includes(`/v1/commits/${ref}`)) delete routes[key];
  });

  it.each([
    BASE,
    "http://aomi.chat",
    "https://aomi.chat:8443",
    "https://aomi.chat/stack",
  ])("sends nothing for %s, which is not production", async (backend) => {
    const { code, stderr } = await tx(
      "sign",
      ...yes,
      ...["--backend-url", backend, "--rpc-url", "https://rpc.example/"],
    );
    expect(code).toBe(3);
    expect(stderr).toContain("This Aomi is not production");
    expect(wrote()).toEqual([]);
    expect(() => readFileSync(join(dir, "cli.json"), "utf8")).toThrow();
  });

  it("refuses an RPC on another chain before signing, and keeps none", async () => {
    routes["POST /"] = rpc("0x1");
    const { code, stderr } = await live("--rpc-url", "https://rpc.example/");
    expect(code).toBe(1);
    expect(stderr).toContain(
      "The RPC is on eip155:1, the commit on eip155:8453",
    );
    expect(wrote()).toEqual([]);
    expect(() => readFileSync(join(dir, "cli.json"), "utf8")).toThrow();
  });

  it("sends on the RPC it checked, whatever the config becomes", async () => {
    routes[`POST /v1/commits/${ref}/sign`] = (body: string) => {
      routes[`GET /v1/commits/${ref}`] = confirmed;
      state({
        baseUrl: BASE,
        rpc: { [LIVE]: { "eip155:8453": "https://other.example/" } },
      });
      return signed(body);
    };
    const hash = () => {
      const sent = wrote()[0]!;
      return { result: keccak256(JSON.parse(sent.body).payloads[0]) };
    };
    routes["POST /"] = rpc("0x2105", hash);
    routes[`POST /v1/commits/${ref}/broadcast`] = confirmed;
    const { code, stdout } = await live("--rpc-url", "https://rpc.example/");
    expect(code).toBe(0);
    expect(stdout).toContain("Confirmed");
    const sent = requests.filter((r) => r.body.includes("eth_sendRaw"));
    expect(sent.map((r) => r.url)).toEqual(["https://rpc.example/"]);
    expect(requests.some((r) => r.url.includes("other.example"))).toBe(false);
  });

  it("prints neither the RPC's key nor signed bytes when a send fails", async () => {
    routes[`POST /v1/commits/${ref}/sign`] = signed;
    routes["POST /s3cret"] = rpc("0x2105", () => ({
      error: {
        code: -32000,
        message: `nonce too low for 0x${"ab".repeat(80)} at https://rpc.example/s3cret`,
      },
    }));
    const { code, stdout, stderr } = await live(
      "--rpc-url",
      "https://rpc.example/s3cret",
    );
    expect(code).toBe(1);
    expect(stderr).toContain("Not sent: ");
    expect(stdout + stderr).not.toMatch(/s3cret|(ab){40}|0x02f8/);
  });

  describe("a Solana transaction", () => {
    beforeEach(() => {
      routes[`GET /v1/commits/${ref}`] = svm;
      routes[`POST /v1/commits/${ref}/renew`] = svm;
      routes[`POST /v1/commits/${ref}/sign`] = (body: string) => ({
        ...svm,
        version: 2,
        state: "awaiting_broadcast",
        action: {
          kind: "broadcast",
          signed_transaction: JSON.parse(body).payloads[0],
          transaction_id: "sig",
        },
      });
    });
    const sign = (...more: string[]) => {
      const argv = ["--solana-private-key", SOLANA_KEY, ...yes, ...more];
      if (!more.includes("--backend-url")) argv.push("--backend-url", LIVE);
      return cli("tx", "sign", ref, ...argv);
    };
    /** The endpoints it was sent to. */
    const sends = () => {
      const urls: string[] = [];
      vi.spyOn(Connection.prototype, "sendRawTransaction").mockImplementation(
        async function (this: Connection) {
          urls.push(this.rpcEndpoint);
          return "sig";
        },
      );
      return urls;
    };

    it("is not signed for a backend that is not production", async () => {
      routes["POST /"] = { result: { value: true } };
      const urls = sends();
      const { code, stderr } = await sign(
        ...["--backend-url", BASE, "--rpc-url", "https://rpc.example/"],
      );
      expect(code).toBe(3);
      expect(stderr).toContain("This Aomi is not production");
      expect(wrote()).toEqual([]);
      expect(urls).toEqual([]);
      expect(() => readFileSync(join(dir, "cli.json"), "utf8")).toThrow();
    });

    it("is sent only where its block is known", async () => {
      routes["POST /"] = { result: { value: false } };
      const urls = sends();
      const other = await sign("--rpc-url", "https://rpc.example/");
      expect(other.code).toBe(1);
      expect(other.stderr).toContain("doesn't know the block");
      expect(urls).toEqual([]);
      const calls = requests.filter((r) => r.key === "POST /");
      expect(calls.map((r) => JSON.parse(r.body).method)).toEqual([
        "isBlockhashValid",
      ]);
      expect(JSON.parse(calls[0]!.body).params[0]).toBe(solana.recentBlockhash);
    });

    it.each([
      ["passed", ""],
      ["passed", "  "],
      ["saved", "  "],
    ])("is not signed with a blank RPC %s: %j", async (how, blank) => {
      const urls = sends();
      const saved = { rpc: { [LIVE]: { "solana:mainnet": blank } } };
      if (how === "saved") state(saved);
      const { code, stderr } = await sign(
        ...(how === "passed" ? ["--rpc-url", blank] : []),
      );
      expect(urls).toEqual([]);
      expect(wrote()).toEqual([]);
      expect(stderr).toContain("The RPC URL for solana:mainnet is blank");
      expect(code).toBe(2);
      if (how !== "saved")
        expect(() => readFileSync(join(dir, "cli.json"), "utf8")).toThrow();
    });

    it("is sent on the RPC that was checked, whatever the config becomes", async () => {
      const urls = sends();
      routes["POST /"] = () => {
        state({ rpc: { [LIVE]: { "solana:mainnet": "" } } });
        return { result: { value: true } };
      };
      const done = { ...svm, version: 3, state: "confirmed", action: null };
      routes[`POST /v1/commits/${ref}/broadcast`] = () =>
        (routes[`GET /v1/commits/${ref}`] = done);
      await sign("--rpc-url", " https://rpc.example/ ");
      const checked = requests.filter((r) => r.key === "POST /");
      expect(checked.map((r) => r.url)).toEqual(["https://rpc.example/"]);
      expect(urls).toEqual(["https://rpc.example/"]);
    });
  });

  it("reviews the decoded call, what it allows and the guard line", async () => {
    const { code, stdout } = await tx("review");
    expect(code).toBe(0);
    expect(stdout).toContain("1. Deposit\n");
    expect(stdout).not.toContain("pool.deposit");
    expect(stdout).toContain(`approve(spender: ${SPENDER}, amountOrId: 1157`);
    expect(stdout).toContain(
      `! allow ${SPENDER} to spend unlimited USDC (${USDC})`,
    );
    expect(stdout).toContain("Guard coverage not reported");
    expect(JSON.parse((await tx("review", "--json")).stdout)).toMatchObject({
      version: 1,
      whole: true,
    });
  });

  it("shows what it signs, and signs nothing without a yes", async () => {
    const { code, stderr } = await tx("sign");
    expect(code).toBe(2);
    expect(stderr).toContain("1. Deposit");
    expect(stderr).toContain("Pass --yes outside a terminal");
    expect(wrote()).toEqual([]);
  });

  it.each([
    ["sign", waiting],
    ["approve", parked],
    ["reject", parked],
  ])("%s --yes needs the version a script reviewed", async (verb, commit) => {
    routes[`GET /v1/commits/${ref}`] = commit;
    const unnamed = await tx(verb, "--yes");
    expect(unnamed.code).toBe(2);
    expect(unnamed.stderr).toContain("--yes needs --version <n>");
    const older = await tx(verb, "--yes", "--version", "7");
    expect(older.code).toBe(1);
    expect(older.stderr).toContain("It is at version 1 now");
    expect(wrote()).toEqual([]);
  });

  it.each([
    ["sign", waiting],
    ["approve", parked],
    ["reject", parked],
  ])("%s only shows a commit it can't show whole", async (verb, commit) => {
    const { review } = commit;
    const opaque = { ...review.request, transactions: [leg("0x12345678")] };
    for (const request of [opaque, null]) {
      routes[`GET /v1/commits/${ref}`] = {
        ...commit,
        review: request && { ...review, request },
      };
      const { code, stderr } = await tx(verb, ...yes);
      expect(code).toBe(3);
      expect(stderr).toContain(`Review this on the sign page: ${BASE}/sign/`);
      expect(stderr).not.toContain('"kind"');
    }
    expect(wrote()).toEqual([]);
  });

  it.each([
    ["sign", waiting],
    ["approve", parked],
    ["reject", parked],
  ])(
    "%s decides nothing that changed after it was shown",
    async (verb, commit) => {
      routes[`GET /v1/commits/${ref}`] = [commit, { ...commit, version: 2 }];
      const { code, stderr } = await (verb === "sign"
        ? live("--rpc-url", "https://rpc.example/")
        : tx(verb, ...yes));
      expect(code).toBe(1);
      expect(stderr).toContain("It changed; review it again");
      expect(wrote()).toEqual([]);
    },
  );

  it.each(["approve", "reject"])(
    "%s leaves an EVM commit without a fee limit to its page",
    async (verb) => {
      const evm = { ...waiting, state: "awaiting_approval", action: null };
      routes[`GET /v1/commits/${ref}`] = evm;
      const { code, stderr } = await tx(verb, ...yes);
      expect(code).toBe(3);
      expect(stderr).toContain("Fee limit not reported, gas ~50000 units");
      expect(stderr).toContain(`Review this on the sign page: ${BASE}/sign/`);
      expect(wrote()).toEqual([]);
    },
  );

  it("rejects the version it showed", async () => {
    routes[`GET /v1/commits/${ref}`] = { ...parked, version: 4 };
    routes[`POST /v1/commits/${ref}/reject`] = {
      ...parked,
      version: 5,
      state: "rejected",
    };
    const { code } = await tx("reject", "--yes", "--version", "4");
    expect(code).toBe(0);
    expect(wrote().map((r) => JSON.parse(r.body))).toEqual([{ version: 4 }]);
  });

  it.each([
    [
      { code: "commit_older_review_first", older_commit_ref: "0ld" },
      "An earlier review is still waiting. Sign or reject it first: aomi tx review 0ld",
    ],
    [
      { code: "commit_restage_needed" },
      "An earlier review was rejected, so this one is out of order. Ask again to prepare it fresh.",
    ],
  ])("says why a nonce is out of order: %j", async (body, says) => {
    routes[`POST /v1/commits/${ref}/sign`] = () =>
      Response.json(body, { status: 409 });
    const { code, stderr } = await live();
    expect(code).toBe(1);
    expect(stderr).toContain(`error: ${says}\n`);
  });
});

it("names a wallet signed in by message, not its protocol", () => {
  expect(
    signsWith({ kind: "connected", label: "w", provider: "siwe" } as never),
  ).toBe("you sign in your wallet");
  expect(
    signsWith({ kind: "connected", label: "w", provider: "para" } as never),
  ).toBe("you sign in Para");
});

describe("aomi library", () => {
  const row = (id: number, name: string, more: object = {}) => ({
    package_id: id,
    id: `acme/${name}`,
    display_name: name,
    description: "",
    icon_url: null,
    chains: ["ethereum", "base"],
    tags: ["lending"],
    tool_count: 1,
    skills: [],
    live: { release: 1, digest: "d" },
    verified: true,
    listed: true,
    agent_listed: false,
    removable: false,
    available: true,
    choice: null,
    enabled: false,
    reason: "off_by_default",
    envelope: {
      hash: "h",
      hosts: ["api.acme.dev"],
      transactions: [],
      signatures: [],
    },
    slots: [],
    tools: [],
    checked: null,
    prepares: ["evm"],
    ...more,
  });
  const packages = [
    row(1, "swap", {
      enabled: true,
      reason: "agent_default",
      slots: [
        {
          name: "API_KEY",
          owner: "person",
          description: "",
          required: true,
          status: "missing",
        },
      ],
    }),
    row(2, "core", {
      enabled: true,
      agent_listed: true,
      reason: "agent_listed",
    }),
    row(3, "lend", {
      checked: { actions: ["borrow", "supply"], contracts: 2 },
      tools: [{ name: "get_rates", description: "Rates now" }],
      skills: [{ id: "lend", description: "How to lend" }],
    }),
    row(4, "vault", {
      display_name: "Vault\u001b[2K",
      chains: ["solana"],
      verified: false,
      listed: false,
      removable: true,
      prepares: ["evm", "svm"],
    }),
  ];

  beforeEach(() => {
    routes["GET /api/account/packages"] = {
      agent: { id: "aomi/main", display_name: "Aomi" },
      packages,
    };
    routes["PUT /api/account/packages/3/choice"] = {
      ...packages[2],
      enabled: true,
    };
    routes["PUT /api/account/packages/4/choice"] = {
      ...packages[3],
      enabled: true,
    };
    routes["POST /api/account/packages/activate"] = packages[3];
    routes["DELETE /api/account/packages/4"] = { removed: true };
    routes["PUT /api/account/packages/1/secrets/API_KEY"] = {
      slot: "API_KEY",
      status: "ready",
    };
  });
  afterEach(() => {
    for (const key of Object.keys(routes))
      if (key.includes("/api/account/packages")) delete routes[key];
  });

  it("lists each package with its state and reason", async () => {
    const { code, stdout } = await cli("library", "--private-key", KEY);
    expect(code).toBe(0);
    expect(stdout.split("\n")).toEqual([
      "acme/swap  on (on by default)  verified  ethereum+base  needs API_KEY",
      "acme/core  on (the agent lists it)  verified  ethereum+base",
      "acme/lend  off (off by default)  verified  ethereum+base",
      "acme/vault  off (off by default)  unverified  solana",
      "",
    ]);
  });

  it("shows the notice and turns nothing on without --yes", async () => {
    const { code, stdout, stderr } = await cli(
      "library",
      "on",
      "acme/lend",
      "--private-key",
      KEY,
    );
    expect(code).toBe(2);
    expect(stdout).toContain("reach api.acme.dev");
    // A text-only package has no transactions of its own, and still prepares.
    expect(stdout).toContain("prepare EVM transactions\n");
    expect(stdout).toContain(
      "checked: borrow, supply on 2 contracts; other calls are partly covered",
    );
    expect(stderr).toContain("--yes");
    expect(requests.some((r) => r.key.startsWith("PUT"))).toBe(false);
  });

  it("turns a package on with --yes", async () => {
    const { code, stdout } = await cli(
      "library",
      "on",
      "acme/lend",
      "--yes",
      "--private-key",
      KEY,
    );
    expect(code).toBe(0);
    expect(stdout).toBe("acme/lend is on\n");
    const sent = requests.find((r) => r.key.startsWith("PUT"));
    expect(sent?.body).toBe('{"enabled":true}');
  });

  it("filters by search, chain, tag and state", async () => {
    const ids = async (...flags: string[]) =>
      (await cli("library", "list", "--private-key", KEY, ...flags)).stdout
        .trim()
        .split("\n")
        .map((line) => line.split("  ")[0]);
    expect(await ids("--search", "VAULT")).toEqual(["acme/vault"]);
    expect(await ids("--chain", "solana")).toEqual(["acme/vault"]);
    expect(await ids("--on", "--tag", "lending")).toEqual([
      "acme/swap",
      "acme/core",
    ]);
    expect(await ids("--tag", "dex")).toEqual([""]);
  });

  it("shows one package, with nothing its name could do to the terminal", async () => {
    const lend = await cli(
      "library",
      "show",
      "acme/lend",
      "--private-key",
      KEY,
    );
    expect(lend.code).toBe(0);
    expect(lend.stdout).toContain(
      "off (off by default) · verified · release 1",
    );
    expect(lend.stdout).toContain("Tools\n  get_rates  Rates now");
    expect(lend.stdout).toContain("Instructions\n  lend  How to lend");
    const vault = await cli("library", "show", "4", "--private-key", KEY);
    expect(vault.stdout).toContain("EVM and Solana transactions");
    expect(vault.stdout).toContain("no check of its own");
    expect(vault.stdout).toContain("Not verified by Aomi.");
    expect(vault.stdout).not.toContain("\u001b");
  });

  it("switches a package in the named thread", async () => {
    const thread = ["--thread", "t 1", "--private-key", KEY];
    await cli("library", "on", "acme/lend", "--yes", ...thread);
    const sent = requests.filter((r) => r.key.includes("/packages"));
    expect(sent.map((r) => new URL(r.url).search)).toEqual([
      "?thread_id=t%201",
      "?thread_id=t%201",
    ]);
  });

  /** Run with `text` on stdin. */
  const typed = async (text: string, ...argv: string[]) => {
    const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
    Object.defineProperty(process, "stdin", {
      value: Readable.from([text]),
      configurable: true,
    });
    try {
      return await cli(...argv, "--private-key", KEY);
    } finally {
      Object.defineProperty(process, "stdin", stdin!);
    }
  };

  it("claims no check for an unverified release", async () => {
    routes["GET /api/account/packages"] = {
      packages: [{ ...packages[2], verified: false }],
    };
    const { stdout } = await cli(
      "library",
      "show",
      "acme/lend",
      "--private-key",
      KEY,
    );
    expect(stdout).not.toContain("checked");
    expect(stdout).toContain("no check of its own");
  });

  it("takes no code on the command line", async () => {
    expect((await cli("library", "add", "code")).code).toBe(2);
  });

  it("adds an unverified package off until its notice is accepted", async () => {
    const asked = await typed(" code \n", "library", "add");
    expect(asked.code).toBe(2);
    expect(asked.stderr).toContain("acme/vault is added, but off");
    expect(asked.stdout).toContain("Not verified by Aomi.");
    expect(requests.some((r) => r.key.startsWith("PUT"))).toBe(false);
    expect(requests.find((r) => r.key.endsWith("activate"))?.body).toBe(
      '{"code":"code"}',
    );
    const yes = await typed("c", "library", "add", "--yes");
    expect(yes.code).toBe(0);
    expect(yes.stdout).toBe("acme/vault is on\n");
  });

  it("adds a verified package on, without asking", async () => {
    routes["POST /api/account/packages/activate"] = packages[0];
    const { code, stdout } = await typed("code", "library", "add");
    expect(code).toBe(0);
    expect(stdout).toBe("acme/swap is added and on\n");
    expect(requests.some((r) => r.key.startsWith("PUT"))).toBe(false);
  });

  it("removes only a package added with a code, once confirmed", async () => {
    const remove = (...args: string[]) =>
      cli("library", "remove", ...args, "--private-key", KEY);
    expect((await remove("acme/vault")).code).toBe(2);
    expect((await remove("acme/lend", "--yes")).stderr).toContain(
      "was not added with a code",
    );
    expect(requests.some((r) => r.key.startsWith("DELETE"))).toBe(false);
    expect((await remove("acme/vault", "--yes")).stdout).toBe(
      "acme/vault is removed\n",
    );
  });

  it("refuses off for an agent-listed package and exits non-zero", async () => {
    const { code, stderr } = await cli(
      "library",
      "off",
      "acme/core",
      "--private-key",
      KEY,
    );
    expect(code).toBe(1);
    expect(stderr).toContain("the agent lists it");
    expect(requests.some((r) => r.key.startsWith("PUT"))).toBe(false);
  });

  it("connects a slot from stdin and never prints the value", async () => {
    const { code, stdout, stderr } = await typed(
      "s3cret-value\n",
      ...["library", "connect", "acme/swap", "API_KEY"],
    );
    expect(code).toBe(0);
    expect(stdout).toBe("API_KEY connected\n");
    expect(stdout + stderr).not.toContain("s3cret-value");
    const sent = requests.find((r) => r.key.startsWith("PUT"));
    expect(sent?.body).toBe('{"value":"s3cret-value"}');
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
    rules: { protocols: null, limits: [], not_after: null, owner_only: true },
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
    enforcement: [],
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
      toolset: null,
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
    const declined = await cli(
      "rules",
      "decline",
      CHANGE,
      "--private-key",
      KEY,
    );
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
