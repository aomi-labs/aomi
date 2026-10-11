#!/usr/bin/env node
// Run a copied Nitro Node artifact without workspace files or dependencies.
// Runtime credentials come from the caller's environment, never CLI arguments.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export function artifactNodeOptions(source = process.env.NODE_OPTIONS ?? "") {
  const matches = [
    ...source.matchAll(/(?:^|\s)--max-old-space-size(?:=|\s+)(\d+)(?=\s|$)/g),
  ];
  const heap = matches.at(-1)?.[1];
  return heap && Number.isSafeInteger(Number(heap)) && Number(heap) > 0
    ? `--max-old-space-size=${heap}`
    : undefined;
}

export const artifactApps = ["portal", "build", "landing", "telegram"];

/** Inspect emitted document metadata, independent of attribute ordering. */
export function assertHtmlHead(html, expected, context = "artifact HTML") {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
  assert.notEqual(head, undefined, `${context}: document head`);
  const decode = (value) =>
    value.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (entity) => {
      const names = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (entity[1] !== "#") return names[entity.toLowerCase()];
      return String.fromCodePoint(
        entity[2].toLowerCase() === "x"
          ? parseInt(entity.slice(3, -1), 16)
          : Number(entity.slice(2, -1)),
      );
    });
  if (expected.title)
    assert.equal(
      decode(head.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] ?? ""),
      expected.title,
      `${context}: document title`,
    );
  const tags = [...head.matchAll(/<meta\b([^>]*)>/gi)].map((tag) =>
    Object.fromEntries(
      [
        ...tag[1].matchAll(/([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi),
      ].map((attribute) => [
        attribute[1].toLowerCase(),
        decode(attribute[2] ?? attribute[3]),
      ]),
    ),
  );
  for (const [attribute, values] of [
    ["name", expected.names],
    ["property", expected.properties],
  ])
    for (const [key, value] of Object.entries(values ?? {})) {
      const matching = tags.filter((tag) => tag[attribute] === key);
      assert.equal(matching.length, 1, `${context}: unique ${key} metadata`);
      assert.equal(matching[0].content, value, `${context}: ${key} metadata`);
    }
}

/** Public apps must prove their own contracts, without fake authenticated probes. */
export function assertArtifactCoverage(app, observed) {
  const checks = observed.checks ?? [];
  const has = (path, predicate) =>
    checks.some(
      (check) => check.path.split("?")[0] === path && predicate(check),
    );
  const ok = (check) => check.status === 200;
  if (app === "portal" || app === "build")
    assert.ok(
      observed.authenticated > 0,
      "No successful authenticated artifact probe ran",
    );
  if (app === "portal")
    assert.ok(observed.streams > 0, "No incremental Portal stream probe ran");
  if (app === "landing") {
    assert.ok(
      has("/", (check) => ok(check) && check.bytesSha256),
      "No exact Landing homepage probe ran",
    );
    assert.ok(
      checks.some(
        (check) =>
          check.path.startsWith("/assets/") && ok(check) && check.bytesSha256,
      ),
      "No exact Landing static asset probe ran",
    );
    assert.ok(
      has("/r/card.json", (check) => ok(check) && check.bytesSha256),
      "No exact Landing registry probe ran",
    );
    assert.ok(
      has("/agents.md", (check) => ok(check) && check.bytesSha256),
      "No exact Landing markdown probe ran",
    );
    for (const path of [
      "/robots.txt",
      "/sitemap.xml",
      "/agents",
      "/research/three-gates-onchain",
    ])
      assert.ok(
        has(path, (check) => ok(check) && check.textIncludes?.length),
        `No rendered Landing ${path} probe ran`,
      );
    assert.ok(
      has("/api/thread/state", (check) => ok(check) && check.json),
      "No controlled Landing backend read probe ran",
    );
    assert.ok(
      has("/api/thread/updates", (check) => ok(check) && check.stream),
      "No incremental Landing stream probe ran",
    );
  }
  if (app === "telegram") {
    assert.ok(
      has(
        "/",
        (check) =>
          ok(check) &&
          check.textIncludes?.includes("Aomi Wallet") &&
          check.textIncludes?.includes("Setting up your wallet…"),
      ),
      "No configured Telegram root shell probe ran",
    );
    assert.ok(
      has(
        "/api/telegram/launch",
        (check) =>
          check.method === "POST" &&
          check.status === 401 &&
          check.json?.error === "bad_signature" &&
          check.headers?.["cache-control"] === "no-store",
      ),
      "No fail-closed Telegram signature probe ran",
    );
  }
}

export function auditArtifactOutput(source, publicDirectory, secretCanary) {
  function audit(directory, ancestors = new Set()) {
    const physical = realpathSync(directory);
    if (ancestors.has(physical))
      throw new Error("The artifact contains a circular directory symlink");
    const nextAncestors = new Set([...ancestors, physical]);
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (/^\.env(?:\.|$)/.test(name) || /\.(?:pem|key)$/.test(name))
        throw new Error("Secret files must not be packaged into the artifact");
      let stat = lstatSync(path);
      if (stat.isSymbolicLink() && !realpathSync(path).startsWith(source + sep))
        throw new Error(
          "The artifact contains a symlink to files outside its output directory",
        );
      if (stat.isSymbolicLink()) stat = statSync(path);
      if (stat.isDirectory()) audit(path, nextAncestors);
      else if (
        secretCanary &&
        path.startsWith(publicDirectory + sep) &&
        /\.(?:[cm]?js|html?|json|map|css)$/i.test(name) &&
        readFileSync(path).includes(Buffer.from(secretCanary))
      )
        throw new Error(
          "A server-secret canary leaked into the public artifact",
        );
    }
  }
  audit(source);
}

/** Validate local Build Output API packaging; this does not contact or deploy to Vercel. */
export function verifyVercelArtifact({
  app,
  artifact,
  secretCanary,
  assets = [],
}) {
  assert.ok(artifactApps.includes(app), "Unknown native app");
  const source = realpathSync(resolve(artifact));
  const staticRoot = join(source, "static");
  assert.ok(existsSync(staticRoot), "Vercel static assets are missing");
  auditArtifactOutput(source, staticRoot, secretCanary);
  const config = JSON.parse(readFileSync(join(source, "config.json"), "utf8"));
  assert.equal(config.version, 3, "Vercel Build Output API version");
  assert.ok(
    config.routes?.some((route) => route.handle === "filesystem"),
    "Vercel static routing is missing",
  );
  assert.ok(
    config.routes?.some((route) => route.dest === "/__server"),
    "Vercel server routing is missing",
  );
  const functions = [];
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(".func")) {
        const metadata = JSON.parse(
          readFileSync(join(path, ".vc-config.json"), "utf8"),
        );
        assert.match(
          metadata.runtime,
          /^nodejs\d+\.x$/,
          `${path}: Node runtime`,
        );
        assert.equal(metadata.launcherType, "Nodejs", `${path}: Node launcher`);
        assert.equal(
          metadata.supportsResponseStreaming,
          true,
          `${path}: streaming support`,
        );
        const handler = resolve(path, metadata.handler);
        assert.ok(
          handler.startsWith(path + sep) && existsSync(handler),
          `${path}: packaged handler`,
        );
        functions.push({ path, metadata });
      } else inspect(path);
    }
  }
  inspect(join(source, "functions"));
  assert.ok(functions.length, "No packaged Vercel functions");
  if (app === "portal")
    for (const route of [
      "v1/agent",
      "v1/agent/[...]",
      "v1/pipeline",
      "v1/pipeline/[...]",
    ]) {
      const entry = functions.find(
        (item) => item.path === join(source, "functions", `${route}.func`),
      );
      assert.equal(
        entry?.metadata.maxDuration,
        300,
        `${route}: streaming duration`,
      );
    }
  if (app === "landing")
    for (const route of ["api/thread/updates", "api/thread/events"]) {
      const entry =
        functions.find(
          (item) => item.path === join(source, "functions", `${route}.func`),
        ) ??
        functions.find(
          (item) => item.path === join(source, "functions", "__server.func"),
        );
      assert.equal(
        entry?.metadata.maxDuration,
        300,
        `${route}: streaming duration`,
      );
    }
  for (const asset of assets) {
    const path = resolve(staticRoot, `.${asset.path}`);
    assert.ok(
      path.startsWith(staticRoot + sep),
      "Assets must remain inside Vercel static output",
    );
    assert.equal(
      createHash("sha256").update(readFileSync(path)).digest("hex"),
      asset.sha256,
      `${asset.path}: packaged bytes`,
    );
  }
  console.log(
    `${app} local Vercel packaging passed (${functions.length} Node functions); hosted deployment was not exercised.`,
  );
}

export async function smokeStartArtifact({
  app,
  artifact,
  checks,
  env: runtimeEnv = process.env,
  configureRuntime,
  probe,
}) {
  if (!artifactApps.includes(app) || !artifact)
    throw new Error(
      "Use --app portal|build|landing|telegram --artifact <.output> --checks <controlled HTTP probes.json>",
    );
  const source = realpathSync(resolve(artifact));
  const secretCanary = runtimeEnv.AOMI_ARTIFACT_SECRET_CANARY;
  if (secretCanary && secretCanary.length < 16)
    throw new Error("Use a server-secret canary of at least 16 characters");
  if (!existsSync(join(source, "server/index.mjs")))
    throw new Error(
      "The artifact must contain the Nitro Node server/index.mjs entry",
    );
  const additional = checks ?? [];
  if (!probe) {
    if (!Array.isArray(additional) || !additional.length)
      throw new Error(
        "Provide controlled HTTP probes; anonymous readiness alone is insufficient",
      );
    if (
      ["portal", "landing"].includes(app) &&
      !additional.some((check) => check.stream)
    )
      throw new Error(
        "Include an incremental streaming probe against a controlled upstream",
      );
    if (
      ["portal", "build"].includes(app) &&
      !additional.some(
        (check) =>
          Object.keys(check.headersFromEnv ?? {}).length &&
          check.status >= 200 &&
          check.status < 300,
      )
    )
      throw new Error(
        "Include a successful authenticated probe with credentials supplied through environment variables",
      );
  }
  for (const check of additional.filter((check) => check.stream)) {
    if (
      (check.stream.minChunks ?? 2) < 2 ||
      !(check.stream.maxFirstChunkMs > 0) ||
      !(check.stream.minDurationMs > check.stream.maxFirstChunkMs)
    )
      throw new Error(
        "Streaming probes must require multiple chunks before the controlled stream completes",
      );
  }

  auditArtifactOutput(source, join(source, "public"), secretCanary);
  console.log(
    secretCanary
      ? "PASS public artifact contains no server-secret canary"
      : "Server-secret canary check not run: AOMI_ARTIFACT_SECRET_CANARY is unset",
  );
  const directory = mkdtempSync(join(tmpdir(), `aomi-${app}-artifact-`));
  const copied = join(directory, ".output");
  try {
    cpSync(source, copied, { recursive: true, dereference: true });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const port = await new Promise((done, fail) => {
    const socket = createServer();
    socket.once("error", fail);
    socket.listen(0, "127.0.0.1", () => {
      const assigned = socket.address().port;
      socket.close(() => done(assigned));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...runtimeEnv,
    ...configureRuntime?.(origin),
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
  };
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  const heapOption = artifactNodeOptions();
  if (heapOption) env.NODE_OPTIONS = heapOption;
  const credentialNames = new Set(
    additional.flatMap((check) => Object.values(check.headersFromEnv ?? {})),
  );
  const credentials = Object.entries(env)
    .filter(
      ([name, value]) =>
        value &&
        (credentialNames.has(name) ||
          /secret|token|password|private[_-]?key|authorization|cookie|credential|(?:^|_)api_key$|(?:^|_)database_url$/i.test(
            name,
          )),
    )
    .flatMap(([, value]) => {
      const text = String(value);
      return [text, JSON.stringify(text).slice(1, -1)];
    })
    .sort((left, right) => right.length - left.length);
  const diagnosticLimit = 16 * 1024;
  // Keep enough overlap to redact a credential crossing the retained boundary.
  const captureLimit = diagnosticLimit + (credentials[0]?.length ?? 0);
  let stderr = "";
  const child = spawn(process.execPath, [join(copied, "server/index.mjs")], {
    cwd: directory,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", () => {
    exited = true;
  });
  child.stdout.resume();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-captureLimit);
  });
  const defaults =
    app === "portal"
      ? [
          { path: "/", status: 200 },
          {
            path: "/openapi.json",
            status: 200,
            headers: { "content-type": "application/json" },
          },
          {
            path: "/oauth/bootstrap",
            status: 200,
            headers: {
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
              "content-security-policy": "frame-ancestors 'none'",
            },
          },
          {
            path: "/v1/account",
            status: 200,
            json: { user: null, guest: false, session: null },
          },
          { path: "/v1/account", method: "PATCH", status: 401 },
          {
            path: "/v1/account",
            requestHeaders: {
              authorization: "Bearer invalid-artifact-credential",
            },
            status: 401,
          },
        ]
      : app === "build"
        ? [
            { path: "/", status: 200 },
            {
              path: "/api/bff/auth/github/status",
              status: 200,
              json: { signedIn: false },
            },
            { path: "/api/bff/deployments/projects", status: 401 },
          ]
        : [{ path: "/", status: 200 }];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !exited; attempt++) {
      try {
        await fetch(origin, { signal: AbortSignal.timeout(1_000) });
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready)
      throw new Error(
        "The copied artifact did not start; inspect the production bundle and runtime configuration",
      );
    const observed = { authenticated: 0, streams: 0, checks: [] };
    async function checkProbe(check) {
      if (
        typeof check.path !== "string" ||
        !check.path.startsWith("/") ||
        check.path.startsWith("//")
      )
        throw new Error("Probes must use a local artifact path");
      const url = new URL(check.path, origin);
      if (url.origin !== origin)
        throw new Error("Probes must use a local artifact path");
      if (
        check.stream &&
        ((check.stream.minChunks ?? 2) < 2 ||
          !(check.stream.maxFirstChunkMs > 0) ||
          !(check.stream.minDurationMs > check.stream.maxFirstChunkMs))
      )
        throw new Error(
          "Streaming probes must require multiple chunks before the controlled stream completes",
        );
      const headers = {
        ...(check.body == null ? {} : { "content-type": "application/json" }),
        ...check.requestHeaders,
      };
      for (const [header, variable] of Object.entries(
        check.headersFromEnv ?? {},
      )) {
        if (!env[variable])
          throw new Error(
            `Missing probe credential environment variable ${variable}`,
          );
        headers[header] = env[variable];
      }
      const started = performance.now();
      const response = await fetch(url, {
        method: check.method ?? "GET",
        headers,
        body: check.body == null ? undefined : JSON.stringify(check.body),
        redirect: "manual",
        signal: AbortSignal.timeout(check.timeoutMs ?? 20_000),
      });
      assert.equal(
        response.status,
        check.status,
        `${check.method ?? "GET"} ${check.path}: status`,
      );
      for (const [name, expected] of Object.entries(check.headers ?? {}))
        assert.ok(
          response.headers.get(name)?.includes(expected),
          `${check.path}: ${name}`,
        );
      let jsonBody;
      if (check.stream) {
        assert.ok(response.body, `${check.path}: stream body`);
        const reader = response.body.getReader();
        let chunks = 0;
        let firstChunkMs;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          if (!result.value.length) continue;
          chunks++;
          firstChunkMs ??= performance.now() - started;
        }
        observed.streams++;
        const durationMs = performance.now() - started;
        assert.ok(
          chunks >= (check.stream.minChunks ?? 2),
          `${check.path}: buffered or incomplete stream`,
        );
        assert.ok(
          firstChunkMs <= check.stream.maxFirstChunkMs,
          `${check.path}: first chunk delayed`,
        );
        assert.ok(
          durationMs >= check.stream.minDurationMs,
          `${check.path}: controlled stream was not observed incrementally`,
        );
      } else if (check.json) {
        const body = await response.json();
        jsonBody = body;
        for (const [key, expected] of Object.entries(check.json))
          assert.deepEqual(
            key.split(".").reduce((value, part) => value?.[part], body),
            expected,
            `${check.path}: JSON ${key}`,
          );
      } else {
        const body = Buffer.from(await response.arrayBuffer());
        if (check.bytesSha256)
          assert.equal(
            createHash("sha256").update(body).digest("hex"),
            check.bytesSha256,
            `${check.path}: exact body bytes`,
          );
        if (check.bytesPrefixHex)
          assert.ok(
            body
              .subarray(0, check.bytesPrefixHex.length / 2)
              .equals(Buffer.from(check.bytesPrefixHex, "hex")),
            `${check.path}: binary signature`,
          );
        for (const text of check.textIncludes ?? [])
          assert.ok(
            body.toString("utf8").includes(text),
            `${check.path}: missing expected text ${text}`,
          );
        for (const text of check.textExcludes ?? [])
          assert.ok(
            !body.toString("utf8").includes(text),
            `${check.path}: unexpected text ${text}`,
          );
        if (check.head)
          assertHtmlHead(body.toString("utf8"), check.head, check.path);
        if (check.bodyAbsent)
          assert.equal(body.length, 0, `${check.path}: unexpected body`);
      }
      if (Object.keys(check.headersFromEnv ?? {}).length && response.ok)
        observed.authenticated++;
      observed.checks.push(check);
      console.log(
        `PASS ${check.method ?? "GET"} ${check.path}: ${response.status}${check.stream ? " incremental stream" : ""}`,
      );
      return jsonBody;
    }
    for (const check of [...defaults, ...additional]) await checkProbe(check);
    if (probe) await probe({ origin, directory, check: checkProbe });
    assertArtifactCoverage(app, observed);
    console.log(`${app} production artifact passed outside the workspace.`);
  } catch (error) {
    let start = Math.max(0, stderr.length - diagnosticLimit);
    for (const value of credentials) {
      const index = stderr.lastIndexOf(value, start);
      if (index >= 0 && index < start && index + value.length > start)
        start = index + value.length;
    }
    let diagnostic = stderr.slice(start);
    for (const value of credentials)
      diagnostic = diagnostic.replaceAll(value, "[redacted]");
    console.error(
      `${app} copied artifact runtime stderr (last ${diagnosticLimit} characters):\n${diagnostic.slice(-diagnosticLimit) || "(no stderr captured)"}`,
    );
    throw error;
  } finally {
    if (!exited) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((done) => child.once("exit", done)),
        delay(3_000, undefined, { ref: false }),
      ]);
      if (!exited) child.kill("SIGKILL");
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const option = (name) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const checksFile = option("--checks");
  if (!checksFile)
    throw new Error("Provide --checks <controlled HTTP probes.json>");
  await smokeStartArtifact({
    app: option("--app"),
    artifact: option("--artifact"),
    checks: JSON.parse(readFileSync(resolve(checksFile), "utf8")),
  });
}
