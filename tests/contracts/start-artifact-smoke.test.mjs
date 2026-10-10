import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { artifactNodeOptions } from "../../scripts/smoke-start-artifact.mjs";

const script = fileURLToPath(
  new URL("../../scripts/smoke-start-artifact.mjs", import.meta.url),
);
const secretCanary = "private-artifact-canary-throwaway-value";
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
