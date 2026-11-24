// @vitest-environment node
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STATE = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/aomi-release-test-${process.pid}`;
  process.env.AOMI_STATE_DIR = path;
  return path;
});

import { main } from "./app";
import { core } from "./build-core";

/** The real `aomi-build-core` and the official packages, when present. */
const BUILT_CORE = process.env.AOMI_BUILD_CORE;
const OFFICIAL =
  process.env.AOMI_PACKAGES_DIR ??
  resolve(import.meta.dirname, "../../../../packages/packages");

const BUILD = "https://build.example";
const CHAT = "https://chat.example";
const KEY = "aomi_key_test";

type Sent = {
  method: string;
  path: string;
  auth: string | null;
  type: string | null;
  body: Uint8Array;
};
let sent: Sent[];
let answers: Record<string, Response | (() => Response)>;
let root: string;

/** Each member's name and bytes, from a ustar archive. */
function untar(archive: Uint8Array): Record<string, Buffer> {
  const members: Record<string, Buffer> = {};
  const text = new TextDecoder();
  for (let offset = 0; archive[offset]; ) {
    const name = text
      .decode(archive.subarray(offset, offset + 100))
      .replace(/\0.*$/s, "");
    const size = parseInt(
      text.decode(archive.subarray(offset + 124, offset + 135)),
      8,
    );
    members[name] = Buffer.from(
      archive.subarray(offset + 512, offset + 512 + size),
    );
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return members;
}

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

/** Each line of `--json` output, parsed. */
const lines = (stdout: string) =>
  stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const write = (path: string, text: string) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), text);
};

const release = (number: number) => ({
  number,
  digest: `sha256:${number}`,
  size: 1,
  contract: 1,
  envelope_hash: "sha256:e",
  tools: ["price"],
  status: "published",
  created_at: "2026-11-16T00:00:00Z",
});

beforeEach(() => {
  sent = [];
  answers = {};
  root = mkdtempSync(join(tmpdir(), "aomi-publish-"));
  process.env.AOMI_BUILDER_KEY = KEY;
  process.env.AOMI_BUILD_URL = BUILD;
  delete process.env.GITHUB_SHA;
  delete process.env.GITHUB_REPOSITORY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const key = `${request.method} ${url.pathname}`;
      sent.push({
        method: request.method,
        path: url.origin + url.pathname,
        auth: request.headers.get("authorization"),
        type: request.headers.get("content-type"),
        body: new Uint8Array(await request.arrayBuffer()),
      });
      const answer = answers[key];
      if (!answer)
        return Response.json({ error: `unexpected ${key}` }, { status: 500 });
      return typeof answer === "function" ? answer() : answer.clone();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AOMI_BACKEND_URL;
  rmSync(STATE, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

describe("aomi build", () => {
  beforeEach(() => {
    write(
      "aomi.toml",
      `[project]\npublisher = "alice"\n\n[[packages]]\npath = "packages/price"\n\n[[agents]]\nname = "hoodit"\nvoice = "agents/hoodit.md"\ndisplay_name = "Hoodit"\nchains = ["evm"]\nmodel_cost = "builder"\naudience = "public"\n`,
    );
    write("agents/hoodit.md", "Be brief.");
    write(
      "packages/price/aomi.toml",
      [
        "[package]",
        'name = "price"',
        'description = "Prices"',
        'icon = "icon.svg"',
        "contract = 1",
        'skills = [{ id = "quote", path = "skills/quote.md", description = "Quotes" }]',
        'guards = "guards.json"',
        "",
      ].join("\n"),
    );
    write(
      "packages/price/icon.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>',
    );
    write("packages/price/skills/quote.md", "# Quote");
    write("packages/price/guards.json", "{}");
    write("packages/price/README.md", "not a member");
    write("price.wasm", "\0asm");
    // A stand-in core: logs each call, lists a root's package paths and
    // agents, names a package after its folder, refuses the manifest of a
    // folder called `bad` and packs a fixed bundle, except for `broken`.
    write(
      "core.cjs",
      String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const { basename, join } = require("node:path");
const args = process.argv.slice(2);
const name = basename(args[1]);
fs.appendFileSync(__dirname + "/core.log", JSON.stringify(args) + "\n");
const answer = (value) => process.stdout.write(JSON.stringify(value) + "\n");
if (args.includes("--lookup"))
  fs.copyFileSync(args[args.indexOf("--lookup") + 1], __dirname + "/lookup.json");
// A test's canned answer for a command; one with an error is a refusal.
const canned = fs.existsSync(__dirname + "/canned.json")
  ? JSON.parse(fs.readFileSync(__dirname + "/canned.json", "utf8"))[args[0]]
  : undefined;
if (canned) {
  answer(canned);
  process.exit(canned.error ? 1 : 0);
}
if (args[0] === "manifest") {
  const text = fs.readFileSync(join(args[1], "aomi.toml"), "utf8");
  const packages = [...text.matchAll(/^path = "(.+)"$/gm)].map(([, path]) =>
    basename(path) === "bad"
      ? { path, error: "manifest_invalid: aomi.toml: bad" }
      : { path, package: basename(path) },
  );
  const agents = [...text.matchAll(/^\[\[agents\]\]\nname = "(.+)"(?:\nvoice = "(.+)")?/gm)];
  answer({
    publisher: "alice",
    packages,
    agents: agents.map(([, name, voice]) => ({ name, voice: voice ?? null })),
  });
  process.exit(0);
}
if (args[0] === "pack" && name === "broken") {
  answer({ error: { code: "bundle_invalid", message: "skills/x.md: missing" } });
  process.exit(1);
}
if (args[0] === "pack") {
  fs.writeFileSync(args[args.indexOf("--out") + 1], "bundle");
  answer({ digest: "sha256:b" });
  process.exit(0);
}
answer({});
`,
    );
    chmodSync(join(root, "core.cjs"), 0o755);
    process.env.AOMI_BUILD_CORE = join(root, "core.cjs");
  });

  afterEach(() => {
    if (BUILT_CORE) process.env.AOMI_BUILD_CORE = BUILT_CORE;
    else delete process.env.AOMI_BUILD_CORE;
  });

  it("packs and checks with aomi-build-core, uploads that bundle, then publishes the agent with its voice", async () => {
    answers["POST /api/build/packages/price/releases"] = Response.json(
      { package: "alice/price", release: release(3), live: 2, verified: false },
      { status: 201 },
    );
    answers["POST /api/build/agents/hoodit/configs"] = Response.json(
      {
        agent: "alice/hoodit",
        config: { number: 1, digest: "sha256:c", created_at: "now" },
        live: null,
      },
      { status: 201 },
    );
    const { code, stdout, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--no-build",
      "--wasm",
      `price=${join(root, "price.wasm")}`,
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);

    const [upload, agent] = sent;
    expect(upload).toMatchObject({
      method: "POST",
      path: `${BUILD}/api/build/packages/price/releases`,
      auth: `Bearer ${KEY}`,
      type: "application/x-tar",
    });
    expect(new TextDecoder().decode(upload!.body)).toBe("bundle");
    const calls = readFileSync(join(root, "core.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const bundle = calls[1]!.at(-1)!;
    expect(calls).toEqual([
      ["manifest", root],
      [
        "pack",
        join(root, "packages/price"),
        "--wasm",
        join(root, "price.wasm"),
        "--out",
        bundle,
      ],
      ["check", bundle],
    ]);
    expect(existsSync(bundle)).toBe(false);
    expect(agent!.path).toBe(`${BUILD}/api/build/agents/hoodit/configs`);
    expect(JSON.parse(new TextDecoder().decode(agent!.body))).toEqual({
      root: expect.stringContaining('name = "hoodit"'),
      files: { "agents/hoodit.md": "Be brief." },
    });
    expect(sent).toHaveLength(2);
    expect(stdout).toContain(
      "package alice/price  release 3  sha256:3  live 2",
    );
    expect(stdout).not.toContain(KEY);
  });

  it.runIf(BUILT_CORE)(
    "publishes text through the built CLI and its platform dependency",
    async () => {
      const platform = `@aomi-labs/build-core-${process.platform}-${process.arch}`;
      const modules = join(root, "node_modules");
      const bin = join(modules, platform, "bin");
      mkdirSync(bin, { recursive: true });
      copyFileSync(
        BUILT_CORE!,
        join(
          bin,
          process.platform === "win32"
            ? "aomi-build-core.exe"
            : "aomi-build-core",
        ),
      );
      write(
        "packages/price/aomi.toml",
        '[package]\nname = "price"\ndescription = "Prices"\ncontract = 1\nskills = [{ id = "quote", path = "skills/quote.md", description = "Quotes" }]',
      );
      const uploads: Buffer[] = [];
      const server = createServer(async (req, res) => {
        if (
          req.method !== "POST" ||
          req.url !== "/api/build/packages/price/releases"
        ) {
          res.writeHead(404).end();
          return;
        }
        const body = [];
        for await (const chunk of req) body.push(chunk);
        uploads.push(Buffer.concat(body));
        res.writeHead(201, { "content-type": "application/json" }).end(
          JSON.stringify({
            package: "alice/price",
            release: release(1),
            live: null,
            verified: false,
          }),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const { port } = server.address() as import("node:net").AddressInfo;
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            resolve(import.meta.dirname, "../dist/bin.js"),
            "build",
            "publish",
            "--root",
            root,
            "--package",
            "price",
          ],
          {
            env: {
              ...process.env,
              AOMI_BUILD_CORE: "",
              NODE_PATH: modules,
              AOMI_BUILD_URL: `http://127.0.0.1:${port}`,
            },
          },
        );
        expect(stdout).toContain("package alice/price  release 1");
        expect(uploads).toHaveLength(1);
        expect(Object.keys(untar(uploads[0]!)).sort()).toEqual([
          "aomi.toml",
          "skills/quote.md",
        ]);
      } finally {
        server.close();
      }
    },
  );

  it("text_only_package_publishes_without_wasm", async () => {
    answers["POST /api/build/packages/price/releases"] = Response.json(
      {
        package: "alice/price",
        release: release(1),
        live: null,
        verified: false,
      },
      { status: 201 },
    );
    // No `src/`: nothing to build, and the bundle has no component.
    const { code, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--package",
      "price",
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const [, pack] = readFileSync(join(root, "core.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(pack).toEqual([
      "pack",
      join(root, "packages/price"),
      "--out",
      pack!.at(-1),
    ]);
    expect(sent).toHaveLength(1);

    // With `src/`, a package needs its component.
    write("packages/price/src/lib.rs", "");
    const built = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--package",
      "price",
      "--no-build",
    );
    expect(built.code).toBe(1);
    expect(built.stderr).toBe(
      "error: price: --no-build needs --wasm price=<path>\n",
    );
    expect(sent).toHaveLength(1);
  });

  it("publishes each selected package that packs, prints each success as it goes, and reports the rest", async () => {
    write(
      "aomi.toml",
      ["price", "broken", "coded"]
        .map((name) => `[[packages]]\npath = "packages/${name}"\n`)
        .concat('[[agents]]\nname = "hoodit"\n')
        .join("\n"),
    );
    write("packages/coded/src/lib.rs", "");
    answers["POST /api/build/packages/price/releases"] = Response.json(
      { package: "alice/price", release: release(1), live: null },
      { status: 201 },
    );
    answers["POST /api/build/agents/hoodit/configs"] = Response.json(
      { code: "agent_invalid", message: "agent hoodit: unknown tool" },
      { status: 422 },
    );
    const { code, stdout, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--package",
      "price",
      "--package",
      "broken",
      "--package",
      "coded",
      "--agent",
      "hoodit",
      "--no-build",
      "--json",
    );
    expect(code).toBe(1);
    const [published, failures] = lines(stdout);
    expect(published).toMatchObject({ package: "alice/price" });
    expect(failures).toEqual({
      failed: [
        {
          kind: "package",
          name: "broken",
          phase: "pack",
          message: "bundle_invalid: skills/x.md: missing",
        },
        {
          kind: "package",
          name: "coded",
          phase: "build",
          message: "--no-build needs --wasm coded=<path>",
        },
        {
          kind: "agent",
          name: "hoodit",
          phase: "upload",
          message: "agent_invalid: agent hoodit: unknown tool",
        },
      ],
    });
    expect(stderr).toBe(
      [
        "error: broken: bundle_invalid: skills/x.md: missing",
        "coded: --no-build needs --wasm coded=<path>",
        "hoodit: agent_invalid: agent hoodit: unknown tool",
        "",
      ].join("\n"),
    );
    expect(sent.map((request) => request.path)).toEqual([
      `${BUILD}/api/build/packages/price/releases`,
      `${BUILD}/api/build/agents/hoodit/configs`,
    ]);
    // Each package packs once; an agent-only publish reads no package.
    const packs = readFileSync(join(root, "core.log"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith('["pack"'));
    expect(packs).toHaveLength(2);
    rmSync(join(root, "core.log"));
    answers["POST /api/build/agents/hoodit/configs"] = Response.json(
      {
        agent: "alice/hoodit",
        config: { number: 1, digest: "sha256:c", created_at: "now" },
        live: null,
      },
      { status: 201 },
    );
    const agent = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--agent",
      "hoodit",
    );
    expect(agent.code).toBe(0);
    expect(readFileSync(join(root, "core.log"), "utf8")).toBe(
      `${JSON.stringify(["manifest", root])}\n`,
    );
  });

  it("leaves manifests to aomi-build-core and publishes the others when one does not pack", async () => {
    write(
      "aomi.toml",
      ["price", "aave", "bad"]
        .map((name) => `[[packages]]\npath = "packages/${name}"\n`)
        .join("\n"),
    );
    // Valid TOML the CLI's own parser refused (AB-T4c).
    write(
      "packages/aave/aomi.toml",
      '[package]\nname = "aave"\n\n[onchain.gateway.check]\ndepositETH = { "0" = "$pool" }\n',
    );
    write("packages/bad/aomi.toml", "[package]\n");
    for (const name of ["price", "aave"])
      answers[`POST /api/build/packages/${name}/releases`] = Response.json(
        { package: `alice/${name}`, release: release(1), live: null },
        { status: 201 },
      );
    const { code, stdout, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
    );
    expect(stdout).toContain("package alice/price  release 1");
    expect(stdout).toContain("package alice/aave  release 1");
    expect(code).toBe(1);
    expect(stderr).toBe(
      "error: packages/bad: manifest_invalid: aomi.toml: bad\n",
    );
  });

  it("prints a refusal's code and exits non-zero", async () => {
    answers["POST /api/build/packages/price/releases"] = Response.json(
      { code: "manifest_invalid", message: "contract must be 1" },
      { status: 422 },
    );
    const { code, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--package",
      "price",
      "--no-build",
      "--wasm",
      `price=${join(root, "price.wasm")}`,
    );
    expect(code).toBe(1);
    expect(stderr).toBe("error: price: manifest_invalid: contract must be 1\n");
    expect(sent).toHaveLength(1);
  });

  it("reports an upload whose promotion is refused, and the promotion as failed", async () => {
    answers["POST /api/build/packages/price/releases"] = Response.json(
      { package: "alice/price", release: release(3), live: 2, verified: false },
      { status: 201 },
    );
    answers["POST /api/build/packages/price/promote"] = Response.json(
      { code: "live_changed", message: "live is 4, not 2" },
      { status: 409 },
    );
    const flags = [
      "build",
      "publish",
      "--root",
      root,
      "--package",
      "price",
      "--promote",
      "--no-build",
      "--wasm",
      `price=${join(root, "price.wasm")}`,
    ];
    const text = await cli(...flags);
    expect(text.code).toBe(1);
    expect(text.stdout).toBe(
      "package alice/price  release 3  sha256:3  live 2\n",
    );
    expect(text.stderr).toBe("error: price: live_changed: live is 4, not 2\n");

    const { stdout } = await cli(...flags, "--json");
    const [published, failures] = lines(stdout);
    expect(published).toMatchObject({ release: { number: 3 }, live: 2 });
    expect(failures).toEqual({
      failed: [
        {
          kind: "package",
          name: "price",
          phase: "promote",
          message: "live_changed: live is 4, not 2",
        },
      ],
    });
  });

  it.runIf(BUILT_CORE)(
    "names a package by [package] name alone, so a manifest pack refuses fails alone",
    async () => {
      process.env.AOMI_BUILD_CORE = BUILT_CORE;
      write(
        "aomi.toml",
        ["price", "nodesc"]
          .map((name) => `[[packages]]\npath = "packages/${name}"\n`)
          .join("\n")
          .replace(/^/, '[project]\npublisher = "alice"\n\n'),
      );
      const manifest = (name: string, description: string) =>
        `[package]\nname = "${name}"\n${description}contract = 1\nskills = [{ id = "quote", path = "skills/quote.md", description = "Quotes" }]\n`;
      write(
        "packages/price/aomi.toml",
        manifest("price", 'description = "Prices"\n'),
      );
      write("packages/nodesc/aomi.toml", manifest("nodesc", ""));
      write("packages/nodesc/skills/quote.md", "# Quote");
      answers["POST /api/build/packages/price/releases"] = Response.json(
        { package: "alice/price", release: release(1), live: null },
        { status: 201 },
      );
      const { code, stdout } = await cli(
        "build",
        "publish",
        "--root",
        root,
        "--package",
        "price",
        "--package",
        "nodesc",
        "--json",
      );
      expect(code).toBe(1);
      const [published, failures] = lines(stdout);
      expect(published).toMatchObject({ package: "alice/price" });
      expect(failures.failed).toEqual([
        expect.objectContaining({
          kind: "package",
          name: "nodesc",
          phase: "pack",
          message: expect.stringMatching(/^manifest_invalid: .*description/),
        }),
      ]);
      expect(sent.map((request) => request.path)).toEqual([
        `${BUILD}/api/build/packages/price/releases`,
      ]);
    },
  );

  it("partial_publish_reports_moved_pointers", async () => {
    answers["POST /api/build/packages/price/releases"] = Response.json(
      { package: "alice/price", release: release(3), live: 2, verified: false },
      { status: 201 },
    );
    answers["POST /api/build/packages/price/promote"] = Response.json({
      package: "alice/price",
      live: 3,
    });
    answers["POST /api/build/agents/hoodit/configs"] = Response.json(
      { code: "agent_invalid", message: "agent hoodit: unknown tool" },
      { status: 422 },
    );
    const { code, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--promote",
      "--no-build",
      "--wasm",
      `price=${join(root, "price.wasm")}`,
    );
    expect(code).toBe(1);
    expect(stderr).toBe(
      [
        "error: hoodit: agent_invalid: agent hoodit: unknown tool",
        "These pointers moved before the failure:",
        "  package alice/price  live 3 (was 2)  undo: aomi build rollback package price 2",
        "",
      ].join("\n"),
    );
  });

  const log = () =>
    readFileSync(join(root, "core.log"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);

  /** A tool's schema as the Pipeline serves it: every key is required. */
  const wants = (keys: Record<string, string | string[]>) => ({
    type: "object",
    properties: Object.fromEntries(
      Object.entries(keys).map(([key, type]) => [key, { type }]),
    ),
    required: Object.keys(keys),
  });

  it("contracts add looks an address up in Aomi's registry and hands the answer to aomi-build-core", async () => {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(
      join(STATE, "cli.json"),
      JSON.stringify({ guest: { baseUrl: CHAT, token: "guest-token" } }),
    );
    process.env.AOMI_BACKEND_URL = CHAT;
    const operation = "/v1/pipeline/operations/evm_get_contract";
    const found = {
      found: true,
      count: 1,
      contracts: [
        {
          address: "0xa0b8",
          chain_id: 1,
          abi: ["function approve(address,uint256)"],
        },
      ],
    };
    answers[`GET ${operation}`] = Response.json({
      name: "evm_get_contract",
      inputSchema: wants({
        address: "string",
        chain_id: "number",
        mode: "string",
        auto_resolve_proxy: "boolean",
        function: "string",
        symbol: "string",
        name: "string",
        protocol: "string",
        contract_type: "string",
        version: "string",
        topic: "string",
      }),
    });
    answers[`POST ${operation}`] = Response.json({ result: found });

    const refused = await cli("build", "contracts", "add", "usdc", "0xa0b8");
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("--chain");
    expect(sent).toHaveLength(0);

    const { code, stderr } = await cli(
      "build",
      "contracts",
      "add",
      "usdc",
      "0xa0b8",
      "--chain",
      "1",
      "--package",
      join(root, "packages/price"),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(sent.at(-1)!.auth).toBe("Bearer guest-token");
    expect(
      JSON.parse(new TextDecoder().decode(sent.at(-1)!.body)),
    ).toMatchObject({ address: "0xa0b8", chain_id: 1, mode: "abi" });
    expect(JSON.parse(readFileSync(join(root, "lookup.json"), "utf8"))).toEqual(
      found,
    );
    expect(log()[0]!.slice(0, 5)).toEqual([
      "contracts",
      "add",
      "usdc",
      "--package",
      join(root, "packages/price"),
    ]);
  });

  it("contracts add looks a Solana program up", async () => {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(
      join(STATE, "cli.json"),
      JSON.stringify({ guest: { baseUrl: CHAT, token: "guest-token" } }),
    );
    process.env.AOMI_BACKEND_URL = CHAT;
    const operation = "/v1/pipeline/operations/svm_get_program";
    answers[`GET ${operation}`] = Response.json({
      name: "svm_get_program",
      inputSchema: wants({
        program_id: ["string", "null"],
        name: ["string", "null"],
        framework: ["string", "null"],
        mode: "string",
        instruction: ["string", "null"],
        topic: "string",
      }),
    });
    answers[`POST ${operation}`] = Response.json({ result: { programs: [] } });
    const { code, stderr } = await cli(
      "build",
      "contracts",
      "add",
      "jup",
      "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
      "--package",
      join(root, "packages/price"),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("pack writes each package's checked bundle to --out, and names an unknown package", async () => {
    const out = join(root, "dist");
    const packed = await cli("build", "pack", "--root", root, "--out", out);
    expect(packed.code).toBe(0);
    expect(packed.stdout).toBe(`price  ${join(out, "price.tar")}  sha256:b\n`);
    expect(readFileSync(join(out, "price.tar"), "utf8")).toBe("bundle");
    expect(log().map((call) => call[0])).toEqual(["manifest", "pack", "check"]);

    const unknown = await cli(
      "build",
      "pack",
      "--root",
      root,
      "--package",
      "nope",
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("nope is not a package of");
  });

  it("test builds, packs and checks each package, and reports one that cannot build", async () => {
    const { code, stdout } = await cli(
      "build",
      "test",
      "--root",
      root,
      "--json",
    );
    expect(code).toBe(0);
    expect(lines(stdout)).toEqual([
      { package: "price", result: "ok", digest: "sha256:b" },
    ]);
    write("packages/price/src/lib.rs", "");
    const built = await cli("build", "test", "--root", root, "--no-build");
    expect(built.code).toBe(1);
    expect(built.stderr).toBe(
      "error: price: --no-build needs --wasm price=<path>\n",
    );
  });

  it("regenerates a package's descriptor before compiling it, and stops when it cannot", async () => {
    write("packages/price/src/lib.rs", "");
    write("packages/price/generated/descriptor.json", "{}");
    write(
      "canned.json",
      JSON.stringify({
        gen: { error: { code: "onchain_missing", message: "no [onchain]" } },
      }),
    );
    const { code, stderr } = await cli("build", "test", "--root", root);
    expect(code).toBe(1);
    expect(stderr).toContain("price: onchain_missing: no [onchain]");
    expect(log().map((call) => call[0])).toEqual(["manifest", "gen"]);
  });

  it("doctor prints each finding and fails on an error", async () => {
    const report = (level: string) => ({
      ok: level !== "error",
      findings: [{ level, subject: "packages/price", message: "a finding" }],
    });
    write("canned.json", JSON.stringify({ doctor: report("warn") }));
    const fine = await cli("build", "doctor", root);
    expect(fine.code).toBe(0);
    expect(fine.stdout).toBe("warn  packages/price  a finding\n");
    write("canned.json", JSON.stringify({ doctor: report("error") }));
    const failed = await cli("build", "doctor", root);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toBe("error: doctor found errors\n");
  });

  it("init, new, tool add and gen hand the folder to aomi-build-core and print its refusal", async () => {
    write(
      "canned.json",
      JSON.stringify({
        init: {
          root: "r/aomi.toml",
          package: { package: "kit", path: "packages/kit" },
        },
        new: { package: "quotes", path: "packages/quotes" },
        tool: {
          error: {
            code: "tool_exists",
            message: "src/lib.rs already has a tool named price",
          },
        },
        gen: { error: { code: "onchain_missing", message: "nothing to do" } },
      }),
    );
    const made = await cli(
      "build",
      "init",
      join(root, "kit"),
      "--publisher",
      "alice",
    );
    expect(made.stdout).toBe("r/aomi.toml  kit  packages/kit\n");
    const added = await cli(
      "build",
      "new",
      "package",
      "quotes",
      "--root",
      root,
    );
    expect(added.code).toBe(0);
    const tool = await cli("build", "tool", "add", "price", "--package", root);
    expect(tool.code).toBe(1);
    expect(tool.stderr).toBe(
      "error: tool_exists: src/lib.rs already has a tool named price\n",
    );
    expect((await cli("build", "gen", "--package", root)).code).toBe(1);
    expect(log()).toEqual([
      ["init", join(root, "kit"), "--publisher", "alice"],
      ["new", "package", "quotes", "--root", root],
      ["tool", "add", "price", "--package", root],
      ["gen", root],
    ]);
  });
});

describe("aomi build rollback", () => {
  it("rollback_requires_target: names no default and sends nothing", async () => {
    const { code, stderr } = await cli("build", "rollback", "package", "price");
    expect(code).not.toBe(0);
    expect(stderr).not.toBe("");
    expect(sent).toHaveLength(0);
  });

  it("promotes the named release and sends the live it read", async () => {
    answers["GET /api/build/packages/price/releases"] = Response.json({
      package: "alice/price",
      live: 4,
      releases: [release(5), release(4), release(2), release(1)],
    });
    answers["POST /api/build/packages/price/promote"] = Response.json({
      package: "alice/price",
      live: 2,
    });
    const { code, stdout } = await cli(
      "build",
      "rollback",
      "package",
      "price",
      "2",
    );
    expect(code).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(sent[1]!.body))).toEqual({
      release: 2,
      expected_live: 4,
    });
    expect(stdout).toBe("package alice/price  live 2 (was 4)\n");
  });

  it("names the moved pointer when the live release changed", async () => {
    answers["GET /api/build/agents/hoodit/configs"] = Response.json({
      agent: "alice/hoodit",
      live: 2,
      configs: [{ number: 2 }, { number: 1 }],
    });
    answers["POST /api/build/agents/hoodit/promote"] = Response.json(
      { code: "live_changed", message: "live is 3", live: 3 },
      { status: 409 },
    );
    const { code, stderr } = await cli(
      "build",
      "rollback",
      "agent",
      "hoodit",
      "1",
    );
    expect(code).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(sent[1]!.body))).toEqual({
      config: 1,
      expected_live: 2,
    });
    expect(stderr).toBe("error: live_changed: live is 3\n");
  });
});

describe("aomi build codes", () => {
  it("creates a code, prints it once, lists and revokes", async () => {
    answers["POST /api/build/packages/price/codes"] = Response.json(
      {
        id: 7,
        package: "alice/price",
        code: "1f3a9c2e-00000000-11111111-22222222",
        agent: null,
        created_at: "2026-11-20T00:00:00Z",
      },
      { status: 201 },
    );
    answers["GET /api/build/packages/price/codes"] = Response.json({
      package: "alice/price",
      codes: [
        {
          id: 7,
          agent: null,
          created_at: "2026-11-20T00:00:00Z",
          revoked_at: null,
          grants: [
            {
              id: 8,
              account: "a",
              agent: null,
              created_at: "x",
              revoked_at: null,
            },
            {
              id: 9,
              account: "b",
              agent: null,
              created_at: "x",
              revoked_at: "y",
            },
          ],
        },
      ],
    });
    answers["DELETE /api/build/packages/price/codes/7"] = Response.json({
      package: "alice/price",
      code: 7,
      revoked: 2,
    });

    const created = await cli("build", "codes", "create", "price");
    expect(created.code).toBe(0);
    expect(created.stdout.split("\n")[0]).toBe(
      "1f3a9c2e-00000000-11111111-22222222",
    );
    expect(created.stdout).toContain("for people with the code");
    const listed = await cli("build", "codes", "list", "price");
    expect(listed.stdout).toBe(
      "   7  2026-11-20T00:00:00Z  people  1 holding  active\n",
    );
    expect(listed.stdout).not.toContain("1f3a9c2e");
    const revoked = await cli("build", "codes", "revoke", "price", "7");
    expect(revoked.stdout).toBe("code 7 revoked\n");
    expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${BUILD}/api/build/packages/price/codes`,
      `GET ${BUILD}/api/build/packages/price/codes`,
      `DELETE ${BUILD}/api/build/packages/price/codes/7`,
    ]);
    expect(JSON.parse(new TextDecoder().decode(sent[0]!.body))).toEqual({});
  });

  it("sends the agent a code is for", async () => {
    answers["POST /api/build/packages/price/codes"] = Response.json(
      {
        id: 3,
        package: "alice/price",
        code: "c",
        agent: "alice/hoodit",
        created_at: "now",
      },
      { status: 201 },
    );
    const { code, stdout } = await cli(
      "build",
      "codes",
      "create",
      "price",
      "--agent",
      "alice/hoodit",
    );
    expect(code).toBe(0);
    expect(stdout).toContain("for alice/hoodit");
    expect(JSON.parse(new TextDecoder().decode(sent[0]!.body))).toEqual({
      agent: "alice/hoodit",
    });
  });
});

/**
 * An official package copied out of the packages repo. Until the manifest
 * fill (phase A) declares `chains`, the copy declares Ethereum, which publish
 * needs for a package that stages transactions.
 */
function official(name: string, dir: string): string {
  const copy = join(dir, name);
  cpSync(join(OFFICIAL, name), copy, { recursive: true });
  const manifest = join(copy, "aomi.toml");
  const text = readFileSync(manifest, "utf8");
  if (text.includes("transactions") && !/^chains\s*=/m.test(text))
    writeFileSync(
      manifest,
      text.replace(/^contract = 1$/m, 'contract = 1\nchains = ["ethereum"]'),
    );
  return copy;
}

describe.runIf(BUILT_CORE && existsSync(OFFICIAL))("aomi-build-core", () => {
  beforeEach(() => {
    process.env.AOMI_BUILD_CORE = BUILT_CORE;
  });

  it("runs the authoring loop: init, new agent, contracts add, gen, doctor, test, pack", async () => {
    const project = join(root, "kit");
    const package_ = join(project, "packages/kit");
    const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    write(
      "usdc.json",
      JSON.stringify([
        {
          type: "function",
          name: "approve",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ name: "", type: "bool" }],
          stateMutability: "nonpayable",
        },
      ]),
    );
    const steps = [
      ["init", project, "--publisher", "alice"],
      ["new", "agent", "desk", "--root", project],
      ["contracts", "add", "usdc", "--file", join(root, "usdc.json")].concat([
        "--address",
        `ethereum=${usdc}`,
        "--package",
        package_,
      ]),
      ["gen", "--package", package_],
      ["doctor", project],
      ["test", "--root", project],
      ["pack", "--root", project, "--out", join(root, "dist")],
    ];
    for (const step of steps) {
      const { code, stderr } = await cli("build", ...step);
      expect(stderr, step.join(" ")).toBe("");
      expect(code, step.join(" ")).toBe(0);
    }
    const toml = readFileSync(join(package_, "aomi.toml"), "utf8");
    expect(toml).toMatch(/^#:schema \.\.\/\.\.\/aomi\.schema\.json\n/);
    expect(toml).toContain("[onchain.usdc]");
    expect(existsSync(join(package_, "generated/descriptor.json"))).toBe(true);
    const bundle = untar(readFileSync(join(root, "dist/kit.tar")));
    expect(Object.keys(bundle)).toContain("abi/usdc.json");

    const again = await cli("build", "init", project, "--publisher", "alice");
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/^error: project_exists: /);
  });

  it("publish refuses what aomi-build-core rejects, before any upload", async () => {
    write(
      "aomi.toml",
      `[project]\npublisher = "aomi"\n\n[[packages]]\npath = "lido"\n`,
    );
    official("lido", root);
    write("lido.wasm", "\0asm");
    const { code, stderr } = await cli(
      "build",
      "publish",
      "--root",
      root,
      "--no-build",
      "--wasm",
      `lido=${join(root, "lido.wasm")}`,
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/^error: lido: not_a_component: /);
    expect(sent).toHaveLength(0);
  });
});
