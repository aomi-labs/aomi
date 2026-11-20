// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "./app";

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
function untar(archive: Uint8Array): Record<string, string> {
  const members: Record<string, string> = {};
  const text = new TextDecoder();
  for (let offset = 0; archive[offset]; ) {
    const name = text
      .decode(archive.subarray(offset, offset + 100))
      .replace(/\0.*$/s, "");
    const size = parseInt(
      text.decode(archive.subarray(offset + 124, offset + 135)),
      8,
    );
    members[name] = text.decode(
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
  });

  it("uploads exactly the package members, then publishes the agent with its voice", async () => {
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
    const members = untar(upload!.body);
    expect(Object.keys(members).sort()).toEqual([
      "aomi.toml",
      "guards.json",
      "icon.svg",
      "package.wasm",
      "skills/quote.md",
    ]);
    expect(members["package.wasm"]).toBe("\0asm");
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
    expect(stderr).toBe("error: manifest_invalid: contract must be 1\n");
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
        "error: agent_invalid: agent hoodit: unknown tool",
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
