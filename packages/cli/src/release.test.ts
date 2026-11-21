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

import { parse } from "toml";
import { main } from "./app";
import { core } from "./build-core";

/** The real `aomi-build-core` and the official packages, when present. */
const BUILT_CORE = process.env.AOMI_BUILD_CORE;
const OFFICIAL =
  process.env.AOMI_PACKAGES_DIR ??
  resolve(import.meta.dirname, "../../../../packages/packages");

const BUILD = "https://build.example";
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
  rmSync(root, { recursive: true, force: true });
});

describe("aomi publish", () => {
  beforeEach(() => {
    write(
      "aomi.toml",
      `[project]\npublisher = "alice"\n\n[[packages]]\npath = "packages/price"\n\n[[agents]]\nname = "hoodit"\nvoice = "agents/hoodit.md"\n`,
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
    // A stand-in core: logs each call, names a package after its folder,
    // packs a fixed bundle, refuses the manifest of a folder called `bad`
    // and the pack of one called `broken`.
    write(
      "core.cjs",
      [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        'const { basename } = require("node:path");',
        "const args = process.argv.slice(2);",
        "const name = basename(args[1]);",
        'fs.appendFileSync(__dirname + "/core.log", JSON.stringify(args) + "\\n");',
        "const refuse = (code, message) => {",
        "  process.stdout.write(JSON.stringify({ error: { code, message } }));",
        "  process.exit(1);",
        "};",
        'if (args[0] === "manifest" && name === "bad") refuse("manifest_invalid", "aomi.toml: bad");',
        'if (args[0] === "pack" && name === "broken") refuse("bundle_invalid", "skills/x.md: missing");',
        'if (args[0] === "pack") fs.writeFileSync(args[args.indexOf("--out") + 1], "bundle");',
        'process.stdout.write(JSON.stringify(args[0] === "manifest" ? { package: name } : {}) + "\\n");',
      ].join("\n"),
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
      ["manifest", join(root, "packages/price")],
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
    expect(JSON.parse(stdout)).toMatchObject({ package: "alice/price" });
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
    const agent = await cli("publish", "--root", root, "--agent", "hoodit");
    expect(agent.code).toBe(0);
    expect(existsSync(join(root, "core.log"))).toBe(false);
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
    const { code, stdout, stderr } = await cli("publish", "--root", root);
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
        "  package alice/price  live 3 (was 2)  undo: aomi rollback package price 2",
        "",
      ].join("\n"),
    );
  });
});

describe("aomi rollback", () => {
  it("rollback_requires_target: names no default and sends nothing", async () => {
    const { code, stderr } = await cli("rollback", "package", "price");
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
    const { code, stdout } = await cli("rollback", "package", "price", "2");
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
    const { code, stderr } = await cli("rollback", "agent", "hoodit", "1");
    expect(code).toBe(1);
    expect(JSON.parse(new TextDecoder().decode(sent[1]!.body))).toEqual({
      config: 1,
      expected_live: 2,
    });
    expect(stderr).toBe("error: live_changed: live is 3\n");
  });
});

describe("aomi codes", () => {
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

    const created = await cli("codes", "create", "price");
    expect(created.code).toBe(0);
    expect(created.stdout.split("\n")[0]).toBe(
      "1f3a9c2e-00000000-11111111-22222222",
    );
    expect(created.stdout).toContain("for people with the code");
    const listed = await cli("codes", "list", "price");
    expect(listed.stdout).toBe(
      "   7  2026-11-20T00:00:00Z  people  1 holding  active\n",
    );
    expect(listed.stdout).not.toContain("1f3a9c2e");
    const revoked = await cli("codes", "revoke", "price", "7");
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

/** A plain ustar archive of `members`, in order. */
function tar(members: [string, Uint8Array][]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const [name, data] of members) {
    const header = new Uint8Array(512);
    const put = (offset: number, text: string) =>
      header.set(encoder.encode(text), offset);
    put(0, name);
    put(100, "0000644\0");
    put(108, "0000000\0");
    put(116, "0000000\0");
    put(124, `${data.length.toString(8).padStart(11, "0")}\0`);
    put(136, "00000000000\0");
    put(148, "        ");
    put(156, "0");
    put(257, "ustar\u000000");
    const sum = header.reduce((total, byte) => total + byte, 0);
    put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(
      header,
      data,
      new Uint8Array((512 - (data.length % 512)) % 512),
    );
  }
  blocks.push(new Uint8Array(1024));
  const archive = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
}

/**
 * The legacy TypeScript packer, kept as an oracle: the members
 * `dir/aomi.toml` declares, in a plain tar.
 */
function tarPackage(dir: string, wasm?: string): Uint8Array {
  const manifest = parse(readFileSync(join(dir, "aomi.toml"), "utf8"));
  const { icon, guards, skills = [] } = manifest.package ?? {};
  const listed = [
    icon,
    ...(skills as { path: string }[]).map((skill) => skill.path),
    guards,
  ].filter((path): path is string => typeof path === "string");
  return tar([
    ["aomi.toml", readFileSync(join(dir, "aomi.toml"))],
    ...(wasm
      ? [["package.wasm", readFileSync(wasm)] as [string, Uint8Array]]
      : []),
    ...listed.map((path): [string, Uint8Array] => [
      path,
      readFileSync(join(dir, path)),
    ]),
  ]);
}

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

  it("the TypeScript packer and aomi-build-core pack the same members on official packages", () => {
    const component = join(root, "component.wasm");
    writeFileSync(component, "\0asm stand-in");
    // One with a component, one with guards, one text-only.
    const cases: [string, string | undefined, string][] = [
      ["defillama", component, "package.wasm"],
      ["lido", component, "guards.json"],
      ["kaito", undefined, "skills/kaito.md"],
    ];
    for (const [name, wasm, member] of cases) {
      const folder = official(name, root);
      const out = join(root, `${name}.tar`);
      core(["pack", folder, ...(wasm ? ["--wasm", wasm] : []), "--out", out]);
      const packed = untar(readFileSync(out));
      const legacy = untar(tarPackage(folder, wasm));
      expect(Object.keys(packed)).toContain(member);
      expect(Object.keys(packed).includes("package.wasm")).toBe(!!wasm);
      // The Manager re-packs an upload from its members alone.
      expect(Object.keys(legacy).sort(), name).toEqual(Object.keys(packed));
      for (const [path, bytes] of Object.entries(packed))
        expect(legacy[path]!.equals(bytes), `${name} ${path}`).toBe(true);
    }
  });

  it("publish refuses what aomi-build-core rejects, before any upload", async () => {
    write(
      "aomi.toml",
      `[project]\npublisher = "aomi"\n\n[[packages]]\npath = "lido"\n`,
    );
    official("lido", root);
    write("lido.wasm", "\0asm");
    const { code, stderr } = await cli(
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
