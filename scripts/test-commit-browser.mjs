#!/usr/bin/env node
// Invoked by the Rust local-chain gate. CommitController, Commit Service and
// both chains are real. The driver supplies the explicit browser gesture; the
// optional external-wallet lane uses a fresh Rabby profile and disposable key.
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
import { resolve, join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const fixture = JSON.parse(input);
assert.equal(new URL(fixture.service_url).hostname, "127.0.0.1");
const extensionMode = fixture.extension_mode === true;
const extensionDir = process.env.COMMIT_BROWSER_RABBY_EXTENSION_DIR;
if (extensionMode) {
  assert.ok(extensionDir, "Rabby extension directory is required");
  assert.equal(new URL(fixture.rpc_url).hostname, "127.0.0.1");
  assert.match(fixture.private_key, /^0x[0-9a-f]{64}$/i);
  assert.ok(Array.isArray(fixture.views) && fixture.views.length > 0);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = resolve(root, "output/playwright/commits");
await mkdir(artifacts, { recursive: true });
const shim = resolve(root, "tests/commit-browser/runtime.tsx");
const clientShim = resolve(root, "tests/commit-browser/client.ts");
let signs = 0,
  sends = 0;
const walletReports = [];
let rabbyEvidenceIndex = 0;
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
            res.end(
              JSON.stringify({
                extension_mode: extensionMode,
                rpc_url: extensionMode ? fixture.rpc_url : undefined,
                view: fixture.view,
                views: extensionMode ? fixture.views : undefined,
              }),
            );
            return;
          }
          if (
            !/^\/api\/commits\/[a-f0-9-]+(?:\/manual|\/wallet-attempts(?:\/[a-f0-9-]+\/report)?)?$/.test(
              req.url ?? "",
            )
          )
            return next();
          try {
            let body = "";
            for await (const chunk of req) body += chunk;
            if (extensionMode && req.url.endsWith("/report")) {
              const outcome = JSON.parse(body);
              if (outcome.kind === "transaction")
                walletReports.push(outcome.transaction_id);
            }
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
        find: "@aomi-labs/client",
        replacement: clientShim,
      },
    ],
  },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
});
let browser;
let profile;
try {
  await server.listen();
  if (extensionMode) {
    profile = await mkdtemp(join(tmpdir(), "aomi-rabby-"));
    browser = await chromium.launchPersistentContext(profile, {
      headless: false,
      viewport: { width: 1000, height: 850 },
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });
  } else {
    browser = await chromium.launch({
      headless: true,
      channel: process.env.COMMIT_BROWSER_CHANNEL || "chrome",
    });
  }
  const page = extensionMode
    ? (browser.pages()[0] ?? (await browser.newPage()))
    : await browser.newPage({ viewport: { width: 1000, height: 850 } });
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
  if (extensionMode) {
    await importRabbyAccount(browser, fixture.private_key);
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole("button", { name: "Connect Rabby" }).click();
    await approveRabbyUntil(browser, artifacts, async () =>
      page
        .getByRole("button", { name: "Rabby connected" })
        .isVisible()
        .catch(() => false),
    );
    for (const [index, view] of fixture.views.entries()) {
      const activeCard = page.locator(`[data-commit-id="${view.commit_id}"]`);
      await activeCard.waitFor({ timeout: 20_000 });
      const send = activeCard.getByRole("button", { name: "Send to wallet" });
      await send.waitFor({ state: "visible" });
      await assertEventuallyEnabled(send);
      await send.click();
      const next = fixture.views[index + 1];
      await approveRabbyUntil(browser, artifacts, async () =>
        next
          ? page
              .locator(`[data-commit-id="${next.commit_id}"]`)
              .isVisible()
              .catch(() => false)
          : (await page
              .locator(`[data-commit-id="${fixture.view.commit_id}"]`)
              .getByRole("status")
              .textContent()
              .catch(() => null)) === "confirmed",
      );
    }
  } else {
    await page.goto(server.resolvedUrls.local[0]);
  }
  const card = page.locator(
    '[data-commit-id="' + fixture.view.commit_id + '"]',
  );
  await card.waitFor();
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await card.getByRole("status").textContent()) === "confirmed") break;
    if (!extensionMode) {
      const button = card.getByRole("button", { name: /^(Sign|Broadcast)$/ });
      if ((await button.count()) && (await button.isEnabled()))
        await button.click();
    }
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
  assert.equal(
    signs,
    !extensionMode && fixture.view.state === "needs_signature" ? 1 : 0,
  );
  assert.equal(
    sends,
    extensionMode ||
      fixture.view.state === "confirmed" ||
      fixture.view.broadcaster === "hosted"
      ? 0
      : 1,
  );
  if (extensionMode) {
    assert.equal(walletReports.length, fixture.views.length);
    const receipts = [];
    for (const transactionId of walletReports) {
      const receipt = await rpc(fixture.rpc_url, "eth_getTransactionReceipt", [
        transactionId,
      ]);
      assert.equal(receipt?.status, "0x1");
      receipts.push({ transaction_id: transactionId, status: receipt.status });
    }
    await writeFile(
      resolve(artifacts, `${fixture.view.thread_id}-rabby-receipts.json`),
      JSON.stringify({ chain_id: 31337, receipts }, null, 2) + "\n",
    );
  }
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
      extension: extensionMode ? "rabby" : undefined,
    }),
  );
} finally {
  await browser?.close();
  await server.close();
  if (profile) await rm(profile, { recursive: true, force: true });
}

async function importRabbyAccount(context, privateKey) {
  const onboarding = await context.newPage();
  await onboarding.goto(
    "chrome-extension://acmacodkjbdgmoleebolmdjonilkdbch/index.html#/new-user/guide",
  );
  await onboarding
    .getByText("I already have an address", { exact: true })
    .click();
  await onboarding
    .getByText("Seed Phrase or Private Key", { exact: true })
    .click();
  await onboarding.getByText("Private Key", { exact: true }).click();
  await onboarding.getByPlaceholder("Input private key").fill(privateKey);
  await onboarding.getByRole("button", { name: "Next", exact: true }).click();
  await finishRabbyOnboarding(onboarding);
  await onboarding.close();
}

async function finishRabbyOnboarding(page) {
  const password = "aomi-local-wallet-31337";
  const passwordInputs = page.locator('input[type="password"]');
  if (
    await passwordInputs
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    const count = await passwordInputs.count();
    for (let index = 0; index < count; index++)
      await passwordInputs.nth(index).fill(password);
    const confirm = page.getByRole("button", {
      name: /confirm|next|create|finish/i,
    });
    await confirm.first().click();
  }
  const finish = page.getByRole("button", { name: /finish|done|start/i });
  if (
    await finish
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
  )
    await finish.first().click();
  await page.waitForTimeout(500);
}

async function approveRabbyUntil(context, artifacts, complete) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await complete()) return;
    for (const candidate of context.pages()) {
      if (!candidate.url().includes("notification.html")) continue;
      const body = await candidate
        .locator("body")
        .innerText()
        .catch(() => "");
      const button = rabbyApprovalButton(candidate, body);
      if (button && (await button.isEnabled().catch(() => false))) {
        const ready = await button
          .click({ trial: true, timeout: 250 })
          .then(() => true)
          .catch(() => false);
        if (!ready) continue;
        rabbyEvidenceIndex += 1;
        await candidate.screenshot({
          path: resolve(artifacts, `rabby-approval-${rabbyEvidenceIndex}.png`),
          fullPage: true,
        });
        await button.click({ timeout: 2_000 });
        break;
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Rabby request did not complete");
}

function rabbyApprovalButton(page, body) {
  if (
    /Connect to Dapp/i.test(body) &&
    /http:\/\/127\.0\.0\.1:\d+/i.test(body) &&
    /Please process the alert before signing/i.test(body)
  )
    return page.getByText("Ignore all", { exact: true }).last();
  if (/Connect to Dapp/i.test(body) && /http:\/\/127\.0\.0\.1:\d+/i.test(body))
    return page.getByRole("button", { name: "Connect", exact: true });
  if (/add (?:a )?(?:custom )?network/i.test(body))
    return page.getByRole("button", { name: /^(?:Add|Confirm)$/i }).last();
  if (/switch (?:the )?network/i.test(body))
    return page.getByRole("button", { name: /^(?:Switch|Confirm)$/i }).last();
  if (/transaction|contract interaction/i.test(body))
    return page
      .getByRole("button", { name: /^(?:Sign|Confirm|Send)$/i })
      .last();
  return undefined;
}

async function assertEventuallyEnabled(locator) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Wallet send control did not become enabled");
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json();
  if (result.error) throw new Error(`Local RPC failed: ${result.error.code}`);
  return result.result;
}
