#!/usr/bin/env node
// Anonymous production UI checks against copied, providerless Nitro artifacts.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  artifactNodeOptions,
  auditArtifactOutput,
} from "./smoke-start-artifact.mjs";
import { artifactFixtureEnvironment } from "./test-start-artifacts.mjs";
import {
  nativeBrowserCases,
  nativeBrowserTransport,
  verifyNativeBrowserReport,
} from "../tests/native-browser/requirements.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

/** The test browser may locate its installed binary, but inherits no credentials. */
export function nativeBrowserEnvironment(source, app, origin) {
  nativeBrowserTransport(app, origin);
  const env = {
    ...artifactFixtureEnvironment(source),
    CI: "1",
    NATIVE_BROWSER_APP: app,
    NATIVE_BROWSER_ORIGIN: origin,
  };
  for (const key of ["HOME", "TMPDIR", "PLAYWRIGHT_BROWSERS_PATH"])
    if (source[key]) env[key] = source[key];
  const heap = artifactNodeOptions(source.NODE_OPTIONS ?? "");
  if (heap) env.NODE_OPTIONS = heap;
  return env;
}

/** A real, temporary TLS edge; both directions retain stream backpressure. */
export async function startBrowserHttps(upstream, parentDirectory) {
  const target = new URL(upstream);
  assert.ok(
    target.protocol === "http:" &&
      target.hostname === "127.0.0.1" &&
      target.port &&
      target.pathname === "/" &&
      !target.search &&
      !target.hash &&
      !target.username &&
      !target.password,
    "TLS proxy requires the copied loopback runtime",
  );
  const parent = realpathSync(parentDirectory);
  const workspace = realpathSync(root);
  assert.ok(
    parent !== workspace && !parent.startsWith(workspace + sep),
    "Ephemeral TLS keys must stay outside the workspace",
  );
  const directory = mkdtempSync(join(parentDirectory, "tls-"));
  chmodSync(directory, 0o700);
  const key = join(directory, "key.pem");
  const certificatePath = join(directory, "certificate.pem");
  const sockets = new Set();
  const requests = new Set();
  let server;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      const ended = server?.listening
        ? new Promise((done, fail) =>
            server.close((error) => (error ? fail(error) : done())),
          )
        : Promise.resolve();
      for (const request of requests) request.destroy();
      for (const socket of sockets) socket.destroy();
      await ended;
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-nodes",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        certificatePath,
        "-subj",
        "/CN=telegram-artifact.localhost",
        "-addext",
        "subjectAltName=DNS:telegram-artifact.localhost",
        "-addext",
        "basicConstraints=critical,CA:FALSE",
      ],
      {
        cwd: directory,
        env: { PATH: process.env.PATH },
        stdio: "ignore",
        timeout: 15_000,
      },
    );
    chmodSync(key, 0o600);
    const certificate = readFileSync(certificatePath);
    server = createHttpsServer(
      { key: readFileSync(key), cert: certificate },
      (request, response) => {
        const forwarded = httpRequest(
          {
            hostname: "127.0.0.1",
            port: target.port,
            path: request.url,
            method: request.method,
            headers: {
              ...request.headers,
              "x-forwarded-proto": "https",
              "x-forwarded-host": request.headers.host,
            },
          },
          (result) => {
            response.writeHead(
              result.statusCode,
              result.statusMessage,
              result.headers,
            );
            response.flushHeaders();
            result.on("error", (error) => response.destroy(error));
            result.pipe(response);
          },
        );
        requests.add(forwarded);
        forwarded.once("close", () => requests.delete(forwarded));
        forwarded.on("error", (error) => {
          if (response.destroyed) return;
          if (response.headersSent) response.destroy(error);
          else {
            response.writeHead(502, { "content-type": "text/plain" });
            response.end("Copied runtime proxy failed");
          }
        });
        request.once("aborted", () => forwarded.destroy());
        request.on("error", () => forwarded.destroy());
        response.on("error", () => forwarded.destroy());
        response.once("close", () => {
          if (!response.writableFinished) forwarded.destroy();
        });
        request.pipe(forwarded);
      },
    );
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise((done, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", fail);
        done();
      });
    });
    return {
      origin: `https://telegram-artifact.localhost:${server.address().port}`,
      certificate,
      directory,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

async function freePort() {
  return new Promise((done, fail) => {
    const socket = createServer();
    socket.once("error", fail);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close((error) => (error ? fail(error) : done(port)));
    });
  });
}

async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const ended = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  await Promise.race([ended, delay(5_000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await ended;
  }
}

async function browserApp(app, artifact) {
  const source = realpathSync(resolve(artifact));
  assert.ok(
    existsSync(join(source, "server/index.mjs")),
    "Build the native Nitro Node artifact first",
  );
  const canary = process.env.AOMI_ARTIFACT_SECRET_CANARY;
  assert.ok(
    canary?.length >= 16,
    "Use the same AOMI_ARTIFACT_SECRET_CANARY for the native build and browser probe",
  );
  auditArtifactOutput(source, join(source, "public"), canary);
  const output = join(root, "output/ci/native-browser", app);
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, "report.json");
  rmSync(reportPath, { force: true });
  const directory = mkdtempSync(
    join(tmpdir(), `aomi-${app}-browser-artifact-`),
  );
  let runtime;
  let browser;
  let tls;
  let stderr = "";
  let spawnError;
  const redact = (text) => text.replaceAll(canary, "[REDACTED]");
  const cancel = () => {
    browser?.kill("SIGTERM");
    runtime?.kill("SIGTERM");
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    assert.ok(
      !realpathSync(directory).startsWith(realpathSync(root) + sep),
      "Artifact runtime cwd must be outside the workspace",
    );
    const copied = join(directory, ".output");
    cpSync(source, copied, { recursive: true, dereference: true });
    const port = await freePort();
    const localOrigin = `http://127.0.0.1:${port}`;
    const env = {
      ...artifactFixtureEnvironment(),
      HOST: "127.0.0.1",
      PORT: String(port),
    };
    const heap = artifactNodeOptions();
    if (heap) env.NODE_OPTIONS = heap;
    runtime = spawn(process.execPath, [join(copied, "server/index.mjs")], {
      cwd: directory,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    runtime.on("error", (error) => {
      spawnError = error;
    });
    runtime.stdout.resume();
    runtime.stderr.setEncoding("utf8");
    runtime.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-(16 * 1024 + canary.length));
    });
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      assert.equal(
        runtime.exitCode,
        null,
        "Copied artifact exited before readiness",
      );
      assert.equal(
        runtime.signalCode,
        null,
        "Copied artifact was interrupted before readiness",
      );
      let response;
      try {
        response = await fetch(localOrigin, {
          signal: AbortSignal.timeout(2_000),
        });
      } catch {
        await delay(100);
        continue;
      }
      assert.equal(
        response.status,
        200,
        "Copied artifact homepage must render",
      );
      const html = await response.text();
      if (app === "telegram") {
        assert.ok(
          html.includes("Aomi Wallet") &&
            html.includes("Setting up your wallet…"),
          "Build Telegram with the valid-shaped nonsensitive public Privy fixture",
        );
      }
      ready = true;
      break;
    }
    assert.ok(ready, "Copied artifact did not become ready");
    if (app === "telegram")
      tls = await startBrowserHttps(localOrigin, directory);
    const origin = tls?.origin ?? localOrigin;
    browser = spawn(
      process.execPath,
      [
        cli,
        "test",
        "--config",
        "tests/native-browser/playwright.config.mjs",
        "--project",
        app,
      ],
      {
        cwd: root,
        env: nativeBrowserEnvironment(process.env, app, origin),
        stdio: "inherit",
      },
    );
    const code = await new Promise((done, fail) => {
      browser.once("error", fail);
      browser.once("exit", done);
    });
    assert.ok(
      existsSync(reportPath),
      "The browser did not produce its required report",
    );
    verifyNativeBrowserReport(
      JSON.parse(readFileSync(reportPath, "utf8")),
      app,
    );
    assert.equal(code, 0, "Native production browser checks failed");
    assert.equal(
      runtime.exitCode,
      null,
      "Copied artifact exited during browser verification",
    );
    console.log(
      `PASS ${app}: ${nativeBrowserCases[app].length} mandatory anonymous production browser cases`,
    );
  } catch (error) {
    if (stderr)
      console.error(
        `Copied ${app} runtime stderr:\n${redact(stderr).slice(-16 * 1024)}`,
      );
    throw error;
  } finally {
    try {
      await stop(browser);
    } finally {
      try {
        await tls?.close();
      } finally {
        try {
          await stop(runtime);
        } finally {
          process.removeListener("SIGINT", cancel);
          process.removeListener("SIGTERM", cancel);
          try {
            writeFileSync(
              join(output, "runtime.log"),
              redact(stderr).slice(-16 * 1024),
            );
          } finally {
            rmSync(directory, { recursive: true, force: true });
          }
        }
      }
    }
  }
}

export async function testNativeBrowser({ app, artifact } = {}) {
  const apps = app ? [app] : Object.keys(nativeBrowserCases);
  assert.ok(
    apps.every((name) => nativeBrowserCases[name]),
    "Use --app landing|telegram",
  );
  assert.ok(!artifact || app, "An explicit artifact requires --app");
  for (const name of apps)
    await browserApp(name, artifact ?? join(root, "apps", name, ".output"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const options = {};
  const args = process.argv.slice(2);
  while (args.length) {
    const name = args.shift();
    assert.ok(
      ["--app", "--artifact"].includes(name) &&
        args[0] &&
        !args[0].startsWith("--"),
      "Use scripts/test-native-browser.mjs [--app landing|telegram] [--artifact <.output>]",
    );
    const key = name.slice(2);
    assert.ok(options[key] === undefined, `Duplicate ${name}`);
    options[key] = args.shift();
  }
  await testNativeBrowser(options);
}
