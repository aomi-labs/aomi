#!/usr/bin/env node
// Run a copied Nitro Node artifact without workspace files or dependencies.
// Runtime credentials come from the caller's environment, never CLI arguments.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

export async function smokeStartArtifact({
  app,
  artifact,
  checks,
  env: runtimeEnv = process.env,
  configureRuntime,
  probe,
}) {
  if (!["portal", "build"].includes(app) || !artifact)
    throw new Error(
      "Use --app portal|build --artifact <.output> --checks <controlled HTTP probes.json>",
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
        "Provide authenticated HTTP probes; anonymous readiness alone is insufficient",
      );
    if (app === "portal" && !additional.some((check) => check.stream))
      throw new Error(
        "Include an incremental streaming probe against a controlled upstream",
      );
    if (
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
        path.startsWith(join(source, "public") + sep) &&
        /\.(?:[cm]?js|html?|json|map|css)$/i.test(name) &&
        readFileSync(path).includes(Buffer.from(secretCanary))
      )
        throw new Error(
          "A server-secret canary leaked into the public artifact",
        );
    }
  }
  audit(source);
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
      : [
          { path: "/", status: 200 },
          {
            path: "/api/bff/auth/github/status",
            status: 200,
            json: { signedIn: false },
          },
          { path: "/api/bff/deployments/projects", status: 401 },
        ];
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
    const observed = { authenticated: 0, streams: 0 };
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
      } else await response.arrayBuffer();
      if (Object.keys(check.headersFromEnv ?? {}).length && response.ok)
        observed.authenticated++;
      console.log(
        `PASS ${check.method ?? "GET"} ${check.path}: ${response.status}${check.stream ? " incremental stream" : ""}`,
      );
      return jsonBody;
    }
    for (const check of [...defaults, ...additional]) await checkProbe(check);
    if (probe) await probe({ origin, directory, check: checkProbe });
    assert.ok(
      observed.authenticated > 0,
      "No successful authenticated artifact probe ran",
    );
    if (app === "portal")
      assert.ok(observed.streams > 0, "No incremental Portal stream probe ran");
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
