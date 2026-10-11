import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeBrowserEnvironment,
  startBrowserHttps,
} from "../../scripts/test-native-browser.mjs";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expectedProviderNetworkError,
  nativeBrowserCases,
  nativeBrowserTransport,
  verifyNativeBrowserReport,
} from "../native-browser/requirements.mjs";

function report(app) {
  return {
    stats: {
      expected: nativeBrowserCases[app].length,
      unexpected: 0,
      skipped: 0,
      flaky: 0,
    },
    suites: [
      {
        specs: nativeBrowserCases[app].map((title) => ({
          title,
          ok: true,
          tests: [
            {
              projectName: app,
              status: "expected",
              results: [{ status: "passed" }],
            },
          ],
        })),
      },
    ],
  };
}

test("native browser verification fails closed on omitted, skipped, flaky and renamed scenarios", () => {
  for (const app of Object.keys(nativeBrowserCases)) {
    assert.doesNotThrow(() => verifyNativeBrowserReport(report(app), app));
    for (const key of ["unexpected", "skipped", "flaky"])
      assert.throws(() =>
        verifyNativeBrowserReport(
          { ...report(app), stats: { ...report(app).stats, [key]: 1 } },
          app,
        ),
      );
    const omitted = report(app);
    omitted.suites[0].specs.pop();
    assert.throws(() => verifyNativeBrowserReport(omitted, app), /omitted/);
    const renamed = report(app);
    renamed.suites[0].specs[0].title = "replacement scenario";
    assert.throws(() => verifyNativeBrowserReport(renamed, app), /changed/);
    const retried = report(app);
    retried.suites[0].specs[0].tests[0].results.push({ status: "passed" });
    assert.throws(() => verifyNativeBrowserReport(retried, app), /retries/);
  }
});

test("CI uses a nonsensitive public Privy fixture accepted by the app and SDK", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const fixtures = [
    ...workflow.matchAll(/^\s+NEXT_PUBLIC_PRIVY_APP_ID:\s*([a-z0-9]+)\s*$/gm),
  ];
  assert.equal(fixtures.length, 1, "expected one shared native-build fixture");
  const appId = fixtures[0][1];
  assert.equal(appId, "a123456789012345678901234");
  assert.match(appId, /^[a-z0-9]{20,32}$/);
  assert.equal(
    appId.length,
    25,
    "Privy react-auth 3.27.1 requires a 25-character app ID",
  );
});

test("browser subprocess inherits only binary locations, a nonsensitive fixture and granted heap", () => {
  const env = nativeBrowserEnvironment(
    {
      PATH: "/fixture/bin",
      HOME: "/fixture/home",
      PLAYWRIGHT_BROWSERS_PATH: "/fixture/chromium",
      AOMI_ARTIFACT_SECRET_CANARY: "fixture-canary-not-a-real-secret",
      NODE_OPTIONS: "--import=/workspace/loader.mjs --max-old-space-size=2048",
      NODE_PATH: "/workspace/node_modules",
      PRIVY_APP_SECRET: "must-not-inherit",
      VERCEL_TOKEN: "must-not-inherit",
      OPENAI_API_KEY: "must-not-inherit",
      DATABASE_URL: "must-not-inherit",
      HTTP_PROXY: "must-not-inherit",
    },
    "telegram",
    "https://telegram-artifact.localhost:1234",
  );
  assert.equal(env.HOME, "/fixture/home");
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, "/fixture/chromium");
  assert.equal(env.NODE_OPTIONS, "--max-old-space-size=2048");
  assert.ok(!Object.values(env).includes("must-not-inherit"));
  assert.equal(env.NODE_PATH, undefined);
});

test("only the isolated Telegram HTTPS context accepts an ephemeral certificate", () => {
  assert.deepEqual(
    nativeBrowserTransport(
      "telegram",
      "https://telegram-artifact.localhost:1234",
    ),
    {
      baseURL: "https://telegram-artifact.localhost:1234",
      ignoreHTTPSErrors: true,
    },
  );
  assert.deepEqual(nativeBrowserTransport("landing", "http://127.0.0.1:1234"), {
    baseURL: "http://127.0.0.1:1234",
    ignoreHTTPSErrors: false,
  });
  for (const [app, origin] of [
    ["telegram", "http://telegram-artifact.localhost:1234"],
    ["telegram", "https://localhost:1234"],
    ["telegram", "https://external.example:1234"],
    ["landing", "https://127.0.0.1:1234"],
    ["landing", "http://user:password@127.0.0.1:1234"],
  ])
    assert.throws(
      () => nativeBrowserTransport(app, origin),
      /isolated local origin/,
    );
});

test(
  "temporary TLS edge preserves duplex streaming, original HTTP semantics and deletes its key",
  { timeout: 15_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "aomi-browser-tls-contract-"));
    let tls;
    let client;
    let ended = false;
    const received = { body: "" };
    const upstream = createServer((request, response) => {
      received.method = request.method;
      received.path = request.url;
      received.header = request.headers["x-browser-fixture"];
      received.host = request.headers.host;
      received.proto = request.headers["x-forwarded-proto"];
      response.writeHead(207, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "x-runtime-fixture": "preserved",
      });
      let first = true;
      request.on("data", (chunk) => {
        received.body += chunk;
        if (first) {
          first = false;
          response.write("data: first\n\n");
        }
      });
      request.on("end", () => {
        ended = true;
        response.end("data: last\n\n");
      });
    });
    await new Promise((done, fail) => {
      upstream.once("error", fail);
      upstream.listen(0, "127.0.0.1", done);
    });
    const originalConfig = process.env.OPENSSL_CONF;
    try {
      // A caller's private OpenSSL configuration must not influence key generation.
      process.env.OPENSSL_CONF = join(directory, "must-not-be-read.cnf");
      tls = await startBrowserHttps(
        `http://127.0.0.1:${upstream.address().port}`,
        directory,
      );
      const url = new URL(tls.origin);
      const connect = {
        hostname: "127.0.0.1",
        port: url.port,
        servername: url.hostname,
        agent: false,
        signal: AbortSignal.timeout(5_000),
      };
      await assert.rejects(
        new Promise((done, fail) => {
          httpsRequest(connect, (response) => {
            response.resume();
            done();
          })
            .once("error", fail)
            .end();
        }),
        (error) =>
          ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(
            error.code,
          ),
      );
      assert.equal(
        statSync(join(tls.directory, "key.pem")).mode & 0o777,
        0o600,
      );
      let resolveFirst;
      let rejectFirst;
      let resolveComplete;
      let rejectComplete;
      const first = new Promise((done, fail) => {
        resolveFirst = done;
        rejectFirst = fail;
      });
      const complete = new Promise((done, fail) => {
        resolveComplete = done;
        rejectComplete = fail;
      });
      complete.catch(() => {});
      const observed = { body: "" };
      client = httpsRequest(
        {
          ...connect,
          ca: tls.certificate,
          path: "/stream?format=sse",
          method: "POST",
          headers: { host: url.host, "x-browser-fixture": "preserved" },
        },
        (response) => {
          observed.status = response.statusCode;
          observed.header = response.headers["x-runtime-fixture"];
          observed.contentType = response.headers["content-type"];
          observed.encrypted = response.socket.encrypted;
          observed.authorized = response.socket.authorized;
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            observed.body += chunk;
            if (observed.body.includes("data: first\n\n")) resolveFirst();
          });
          response.once("error", (error) => {
            rejectFirst(error);
            rejectComplete(error);
          });
          response.once("end", resolveComplete);
        },
      );
      client.on("error", (error) => {
        rejectFirst(error);
        rejectComplete(error);
      });
      client.write("request-first\n");
      await first;
      assert.equal(
        ended,
        false,
        "Both directions must stream before the request completes",
      );
      assert.equal(observed.body, "data: first\n\n");
      client.end("request-last\n");
      await complete;
      assert.deepEqual(received, {
        method: "POST",
        path: "/stream?format=sse",
        header: "preserved",
        host: url.host,
        proto: "https",
        body: "request-first\nrequest-last\n",
      });
      assert.deepEqual(observed, {
        status: 207,
        header: "preserved",
        contentType: "text/event-stream",
        encrypted: true,
        authorized: true,
        body: "data: first\n\ndata: last\n\n",
      });
      await tls.close();
      assert.equal(
        existsSync(tls.directory),
        false,
        "TLS private key and certificate must be deleted",
      );
      await assert.rejects(
        new Promise((done, fail) => {
          httpsRequest({ ...connect, ca: tls.certificate }, (response) => {
            response.resume();
            done();
          })
            .once("error", fail)
            .end();
        }),
        (error) => error.code === "ECONNREFUSED",
      );
    } finally {
      if (originalConfig === undefined) delete process.env.OPENSSL_CONF;
      else process.env.OPENSSL_CONF = originalConfig;
      client?.destroy();
      await tls?.close();
      const closed = new Promise((done) => upstream.close(done));
      upstream.closeAllConnections();
      await closed;
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("expected public-provider failures do not hide application or unidentified network errors", () => {
  const url = "https://auth.privy.io/api/v1/apps/a123456789012345678901234";
  assert.equal(
    expectedProviderNetworkError(
      { message: `[GET] "${url}": <no response> Failed to fetch` },
      [url],
    ),
    true,
  );
  assert.equal(
    expectedProviderNetworkError({ message: `[GET] "${url}": 404 Not Found` }, [
      url,
    ]),
    true,
  );
  assert.equal(
    expectedProviderNetworkError(
      { message: "Cannot read properties of undefined", stack: url },
      [url],
    ),
    false,
  );
  assert.equal(
    expectedProviderNetworkError({ message: "Failed to fetch" }, [url]),
    false,
  );
  assert.equal(
    expectedProviderNetworkError({ message: `Failed to fetch ${url}` }, []),
    false,
  );
  assert.equal(
    expectedProviderNetworkError(
      { message: "Failed to fetch https://app.test/assets/main.js" },
      [url],
    ),
    false,
  );
});
