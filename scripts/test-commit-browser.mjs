#!/usr/bin/env node
// Invoked by the Rust local-chain gate. The signer is a deterministic stand-in;
// CommitReview, CommitController, Commit Service and both chains are real.
import { createRequire } from "node:module";
const localRequire = createRequire(import.meta.url);
const { createServer } = await import(
  createRequire(localRequire.resolve("vitest/package.json")).resolve("vite")
);
const { default: react } = await import(
  createRequire(
    new URL("../apps/shadcn-registry/package.json", import.meta.url),
  ).resolve("@vitejs/plugin-react")
);
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const fixture = JSON.parse(input);
assert.equal(new URL(fixture.service_url).hostname, "127.0.0.1");
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = resolve(root, "output/playwright/commits");
await mkdir(artifacts, { recursive: true });
const shim = resolve(root, "tests/commit-browser/runtime.tsx");
let signs = 0,
  sends = 0;
const server = await createServer({
  configFile: false,
  root: resolve(root, "tests/commit-browser"),
  logLevel: "error",
  plugins: [
    react(),
    {
      name: "local-commit-proxy",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url === "/__fixture") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ view: fixture.view }));
            return;
          }
          if (!/^\/api\/commits\/[a-f0-9-]+(?:\/manual)?$/.test(req.url ?? ""))
            return next();
          try {
            let body = "";
            for await (const chunk of req) body += chunk;
            const upstream = await fetch(
              fixture.service_url + req.url.slice(4),
              {
                method: req.method,
                headers: {
                  "content-type": "application/json",
                  authorization: "Bearer " + fixture.bearer,
                },
                body: req.method === "POST" ? body : undefined,
              },
            );
            res.statusCode = upstream.status;
            res.setHeader("content-type", "application/json");
            res.end(await upstream.text());
          } catch {
            res.statusCode = 502;
            res.end(JSON.stringify({ code: "fixture_proxy_failed" }));
          }
        });
      },
    },
  ],
  resolve: {
    alias: [
      { find: "@aomi-labs/react", replacement: shim },
      {
        find: "../../lib/wallet-kit/use-action-capabilities",
        replacement: shim,
      },
      {
        find: "@aomi-labs/client",
        replacement: resolve(root, "packages/client/src/commits.ts"),
      },
    ],
  },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.COMMIT_BROWSER_CHANNEL || "chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1000, height: 850 },
  });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.exposeFunction("fixtureSign", async (id, payload) => {
    assert.equal(id, fixture.view.commit_id);
    assert.deepEqual(payload, fixture.view.action.payload);
    signs++;
    return fixture.payloads;
  });
  await page.exposeFunction("fixtureBroadcast", async (id, bytes) => {
    assert.equal(id, fixture.view.commit_id);
    sends++;
    const svm = fixture.view.chain_family === "svm";
    const response = await fetch(
      svm ? "http://127.0.0.1:18899" : "http://127.0.0.1:18545",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: svm ? "sendTransaction" : "eth_sendRawTransaction",
          params: svm
            ? [bytes, { encoding: "base64", preflightCommitment: "confirmed" }]
            : [bytes],
        }),
      },
    );
    const result = await response.json();
    if (result.error) throw new Error("Local chain rejected fixture payload");
    return result.result;
  });
  await page.goto(server.resolvedUrls.local[0]);
  const card = page.locator(
    '[data-commit-id="' + fixture.view.commit_id + '"]',
  );
  await card.waitFor();
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await card.getByRole("status").textContent()) === "confirmed") break;
    const button = card.getByRole("button", { name: /^(Sign|Broadcast)$/ });
    if ((await button.count()) && (await button.isEnabled()))
      await button.click();
    await page.waitForTimeout(100);
  }
  await page.screenshot({
    path: resolve(artifacts, fixture.view.thread_id + ".png"),
    fullPage: true,
  });
  assert.equal(
    await card.getByRole("status").textContent(),
    "confirmed",
    JSON.stringify({
      alerts: await page.getByRole("alert").allTextContents(),
      failures,
      signs,
      sends,
    }),
  );
  assert.deepEqual(failures, []);
  assert.equal(signs, fixture.view.state === "needs_signature" ? 1 : 0);
  assert.equal(
    sends,
    fixture.view.state === "confirmed" || fixture.view.broadcaster === "hosted"
      ? 0
      : 1,
  );
  await page.screenshot({
    path: resolve(artifacts, fixture.view.thread_id + ".png"),
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      thread: fixture.view.thread_id,
      state: "confirmed",
      signs,
      sends,
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
