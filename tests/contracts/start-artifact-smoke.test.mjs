import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  artifactNodeOptions,
  assertHtmlHead,
  verifyVercelArtifact,
} from "../../scripts/smoke-start-artifact.mjs";

const script = fileURLToPath(
  new URL("../../scripts/smoke-start-artifact.mjs", import.meta.url),
);
const secretCanary = "private-artifact-canary-throwaway-value";
const hash = (body) => createHash("sha256").update(body).digest("hex");

test("article and listing metadata must appear in the document head with unique semantic tags", () => {
  const expected = {
    title: "Tasks & proofs",
    names: { robots: "noindex, nofollow" },
    properties: { "og:type": "article" },
  };
  const head = `<title>Tasks &amp; proofs</title><meta content="noindex, nofollow" name="robots"><meta content='article' property='og:type'>`;
  assert.doesNotThrow(() =>
    assertHtmlHead(
      `<html><head>${head}</head><body>Blog</body></html>`,
      expected,
    ),
  );
  assert.throws(
    () =>
      assertHtmlHead(
        `<html><head></head><body>${head}</body></html>`,
        expected,
      ),
    /document title/,
  );
  assert.throws(
    () =>
      assertHtmlHead(
        `<head>${head}<meta name="robots" content="index, follow"></head>`,
        expected,
      ),
    /unique robots/,
  );
  assert.throws(
    () =>
      assertHtmlHead(
        `<head>${head.replace("noindex, nofollow", "index, follow")}</head>`,
        expected,
      ),
    /robots metadata/,
  );
});

function fixture(buffered) {
  const directory = mkdtempSync(join(tmpdir(), "aomi-artifact-probe-test-"));
  const artifact = join(directory, ".output");
  mkdirSync(join(artifact, "server"), { recursive: true });
  writeFileSync(
    join(artifact, "server/index.mjs"),
    `
    import { createServer } from 'node:http';
    createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/bff/auth/github/status') res.end(JSON.stringify({ signedIn: false }));
      else if (req.url === '/api/bff/deployments/projects') { res.statusCode = 401; res.end('{}'); }
      else if (req.url === '/authenticated') {
        res.statusCode = req.headers.authorization === process.env.SMOKE_FIXTURE_CREDENTIAL ? 200 : 401;
        res.end(JSON.stringify({ identity: 'artifact-fixture' }));
      } else if (req.url === '/stream') {
        ${buffered ? "" : "res.write('first\\n');"}
        setTimeout(() => res.end(${buffered ? "'first\\nlast\\n'" : "'last\\n'"}), 1_000);
      } else res.end('{}');
    }).listen(process.env.PORT, process.env.HOST);
  `,
  );
  const checks = join(directory, "checks.json");
  writeFileSync(
    checks,
    JSON.stringify([
      {
        path: "/authenticated",
        status: 200,
        headersFromEnv: { authorization: "SMOKE_FIXTURE_CREDENTIAL" },
        json: { identity: "artifact-fixture" },
      },
      {
        path: "/stream",
        status: 200,
        stream: { maxFirstChunkMs: 800, minDurationMs: 900 },
      },
    ]),
  );
  return {
    directory,
    artifact,
    run() {
      return spawnSync(
        process.execPath,
        [script, "--app", "build", "--artifact", artifact, "--checks", checks],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: {
            ...process.env,
            SMOKE_FIXTURE_CREDENTIAL: "Bearer throwaway-artifact-probe",
            AOMI_ARTIFACT_SECRET_CANARY: secretCanary,
          },
        },
      );
    },
  };
}

test("copied artifact smoke authenticates and observes incremental data outside the workspace", () => {
  const setup = fixture(false);
  try {
    const result = setup.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /production artifact passed outside the workspace/,
    );
    assert.ok(!result.stdout.includes("throwaway-artifact-probe"));
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("a buffered stream cannot pass the production artifact probe", () => {
  const setup = fixture(true);
  try {
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /buffered or incomplete stream/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("workspace dependency links are rejected before artifact startup", () => {
  const setup = fixture(false);
  try {
    const outside = join(setup.directory, "workspace-only.mjs");
    writeFileSync(outside, "export const workspaceOnly = true;");
    symlinkSync(outside, join(setup.artifact, "server/workspace-only.mjs"));
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink to files outside/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("server-secret canaries in nested public source maps block artifact startup", () => {
  const setup = fixture(false);
  try {
    const assets = join(setup.artifact, "public/assets");
    mkdirSync(assets, { recursive: true });
    writeFileSync(
      join(assets, "client.js.map"),
      JSON.stringify({ sourcesContent: [`const secret = '${secretCanary}'`] }),
    );
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /server-secret canary leaked into the public artifact/,
    );
    assert.ok(!result.stderr.includes(secretCanary));
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("public directory links cannot conceal a server-secret canary", () => {
  const setup = fixture(false);
  try {
    const shared = join(setup.artifact, "server/shared-assets");
    mkdirSync(shared, { recursive: true });
    mkdirSync(join(setup.artifact, "public"));
    writeFileSync(
      join(shared, "client.js"),
      `export default '${secretCanary}';`,
    );
    symlinkSync(shared, join(setup.artifact, "public/assets"));
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /server-secret canary leaked/);
    assert.ok(!result.stderr.includes(secretCanary));
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("probe paths cannot send artifact credentials to a different origin", () => {
  const setup = fixture(false);
  try {
    writeFileSync(
      join(setup.directory, "checks.json"),
      JSON.stringify([
        {
          path: "/\\external.invalid/authenticated",
          status: 200,
          headersFromEnv: { authorization: "SMOKE_FIXTURE_CREDENTIAL" },
        },
      ]),
    );
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Probes must use a local artifact path/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("artifact isolation retains only the granted Node heap option", () => {
  assert.equal(
    artifactNodeOptions(
      "--require=/workspace/loader.cjs --max-old-space-size=3072 --import tsx --no-warnings",
    ),
    "--max-old-space-size=3072",
  );
  assert.equal(
    artifactNodeOptions("--max-old-space-size 2048 --conditions=workspace"),
    "--max-old-space-size=2048",
  );
  assert.equal(
    artifactNodeOptions("--loader=/workspace/loader.mjs"),
    undefined,
  );
  assert.equal(artifactNodeOptions("--max-old-space-size=0"), undefined);
});

test("runtime failures report bounded diagnostics without configured credentials", () => {
  const setup = fixture(false);
  try {
    writeFileSync(
      join(setup.artifact, "server/index.mjs"),
      `import { createServer } from 'node:http';
      createServer((_req, res) => {
        console.error('x'.repeat(30_000));
        console.error(process.env.SMOKE_FIXTURE_CREDENTIAL);
        console.error('controlled SSR dependency failure');
        res.writeHead(500).end('failed');
      }).listen(process.env.PORT, process.env.HOST);`,
    );
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /controlled SSR dependency failure/);
    assert.match(result.stderr, /\[redacted\]/);
    assert.ok(!result.stderr.includes("throwaway-artifact-probe"));
    assert.ok(result.stderr.length < 20_000);
    assert.match(result.stderr, /GET \/: status/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

function publicFixture(app, signatureStatus = 401) {
  const setup = fixture(false);
  const replies =
    app === "landing"
      ? {
          "/": "preserved homepage",
          "/assets/home.js": "preserved asset",
          "/r/card.json": '{"name":"card"}',
          "/agents.md": "# Aomi for Agents",
          "/robots.txt": "User-Agent: GPTBot",
          "/sitemap.xml": "<urlset></urlset>",
          "/agents": "<html>Aomi agents</html>",
          "/research/three-gates-onchain": "<html>Three Gates</html>",
          "/api/thread/state": '{"thread_id":"fixture-thread"}',
        }
      : { "/": "<html>Aomi Wallet Setting up your wallet…</html>" };
  writeFileSync(
    join(setup.artifact, "server/index.mjs"),
    `
    import { createServer } from 'node:http';
    const replies = ${JSON.stringify(replies)};
    createServer((req, res) => {
      if (req.url === '/api/thread/updates') {
        res.writeHead(200, {'content-type': 'text/event-stream'});
        res.write('first\\n'); setTimeout(() => res.end('last\\n'), 1_000);
      } else if (req.url === '/api/telegram/launch' && req.method === 'POST') {
        res.writeHead(${signatureStatus}, {'content-type': 'application/json', 'cache-control': 'no-store'});
        res.end(JSON.stringify({error: 'bad_signature'}));
      } else if (replies[req.url] !== undefined) {
        res.writeHead(200, {'content-type': req.url.endsWith('.json') || req.url === '/api/thread/state' ? 'application/json' : 'text/html'});
        res.end(replies[req.url]);
      } else res.writeHead(404).end('wrong app defaults');
    }).listen(process.env.PORT, process.env.HOST);
  `,
  );
  const checks =
    app === "landing"
      ? [
          ...["/", "/assets/home.js", "/r/card.json", "/agents.md"].map(
            (path) => ({ path, status: 200, bytesSha256: hash(replies[path]) }),
          ),
          ...[
            "/robots.txt",
            "/sitemap.xml",
            "/agents",
            "/research/three-gates-onchain",
          ].map((path) => ({
            path,
            status: 200,
            textIncludes: [replies[path]],
          })),
          {
            path: "/api/thread/state",
            status: 200,
            json: { thread_id: "fixture-thread" },
          },
          {
            path: "/api/thread/updates",
            status: 200,
            stream: { maxFirstChunkMs: 800, minDurationMs: 900 },
          },
        ]
      : [
          {
            path: "/",
            status: 200,
            textIncludes: ["Aomi Wallet", "Setting up your wallet…"],
          },
          {
            path: "/api/telegram/launch",
            method: "POST",
            body: { controlledInvalidSignature: true },
            status: 401,
            headers: { "cache-control": "no-store" },
            json: { error: "bad_signature" },
          },
        ];
  writeFileSync(join(setup.directory, "checks.json"), JSON.stringify(checks));
  return {
    ...setup,
    checks,
    run() {
      return spawnSync(
        process.execPath,
        [
          script,
          "--app",
          app,
          "--artifact",
          setup.artifact,
          "--checks",
          join(setup.directory, "checks.json"),
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          env: { ...process.env, AOMI_ARTIFACT_SECRET_CANARY: secretCanary },
        },
      );
    },
  };
}

test("Landing copied artifact proves public content, assets and streaming without Build defaults or invented auth", () => {
  const setup = publicFixture("landing");
  try {
    const result = setup.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /landing production artifact passed/);
    assert.ok(!result.stdout.includes("/api/bff/"));
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("Landing readiness and stream cannot conceal missing exact static assets", () => {
  const setup = publicFixture("landing");
  try {
    writeFileSync(
      join(setup.directory, "checks.json"),
      JSON.stringify(
        setup.checks.filter((check) => !check.path.startsWith("/assets/")),
      ),
    );
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /No exact Landing static asset probe/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("exact artifact bytes reject an otherwise successful altered homepage", () => {
  const setup = publicFixture("landing");
  try {
    setup.checks[0].bytesSha256 = hash("altered homepage");
    writeFileSync(
      join(setup.directory, "checks.json"),
      JSON.stringify(setup.checks),
    );
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact body bytes/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("Telegram copied artifact requires a rendered shell and no-store signature rejection", () => {
  const setup = publicFixture("telegram");
  try {
    const result = setup.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /telegram production artifact passed/);
    assert.ok(!result.stdout.includes("/api/bff/"));
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("Telegram accepting an invalid signature cannot pass the artifact probe", () => {
  const setup = publicFixture("telegram", 200);
  try {
    const result = setup.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /POST \/api\/telegram\/launch: status/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

function vercelFixture(app) {
  const directory = mkdtempSync(join(tmpdir(), "aomi-vercel-packaging-test-"));
  mkdirSync(join(directory, "static/assets"), { recursive: true });
  writeFileSync(
    join(directory, "static/assets/client.js"),
    "local static asset",
  );
  writeFileSync(
    join(directory, "config.json"),
    JSON.stringify({
      version: 3,
      routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/__server" }],
    }),
  );
  const routes =
    app === "portal"
      ? [
          "__server",
          "v1/agent",
          "v1/agent/[...]",
          "v1/pipeline",
          "v1/pipeline/[...]",
        ]
      : ["__server"];
  for (const route of routes) {
    const path = join(directory, "functions", `${route}.func`);
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "index.mjs"),
      "export default () => new Response('local');",
    );
    writeFileSync(
      join(path, ".vc-config.json"),
      JSON.stringify({
        handler: "index.mjs",
        launcherType: "Nodejs",
        runtime: "nodejs22.x",
        supportsResponseStreaming: true,
        ...(route === "__server" && app !== "landing"
          ? {}
          : { maxDuration: 300 }),
      }),
    );
  }
  return {
    directory,
    verify() {
      verifyVercelArtifact({
        app,
        artifact: directory,
        secretCanary,
        assets: [
          { path: "/assets/client.js", sha256: hash("local static asset") },
        ],
      });
    },
  };
}

test("all four native hosts require self-contained Vercel Node functions and exact static assets", () => {
  for (const app of ["portal", "build", "landing", "telegram"]) {
    const setup = vercelFixture(app);
    try {
      setup.verify();
    } finally {
      rmSync(setup.directory, { recursive: true, force: true });
    }
  }
});

test("Vercel public source-map canaries block packaging verification", () => {
  const setup = vercelFixture("landing");
  try {
    writeFileSync(
      join(setup.directory, "static/assets/client.js.map"),
      JSON.stringify({ sourcesContent: [secretCanary] }),
    );
    assert.throws(() => setup.verify(), /server-secret canary leaked/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("Portal Vercel streaming functions must retain their 300-second duration", () => {
  const setup = vercelFixture("portal");
  try {
    writeFileSync(
      join(setup.directory, "functions/v1/agent.func/.vc-config.json"),
      JSON.stringify({
        handler: "index.mjs",
        launcherType: "Nodejs",
        runtime: "nodejs22.x",
        supportsResponseStreaming: true,
        maxDuration: 30,
      }),
    );
    assert.throws(() => setup.verify(), /streaming duration/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("Vercel function metadata cannot disable streaming or reference a missing handler", () => {
  const setup = vercelFixture("telegram");
  try {
    const path = join(
      setup.directory,
      "functions/__server.func/.vc-config.json",
    );
    const metadata = {
      handler: "index.mjs",
      launcherType: "Nodejs",
      runtime: "nodejs22.x",
      supportsResponseStreaming: false,
    };
    writeFileSync(path, JSON.stringify(metadata));
    assert.throws(() => setup.verify(), /streaming support/);
    metadata.supportsResponseStreaming = true;
    metadata.handler = "missing.mjs";
    writeFileSync(path, JSON.stringify(metadata));
    assert.throws(() => setup.verify(), /packaged handler/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});

test("Vercel static asset changes cannot pass the immutable byte check", () => {
  const setup = vercelFixture("build");
  try {
    writeFileSync(
      join(setup.directory, "static/assets/client.js"),
      "unexpectedly altered asset",
    );
    assert.throws(() => setup.verify(), /packaged bytes/);
  } finally {
    rmSync(setup.directory, { recursive: true, force: true });
  }
});
