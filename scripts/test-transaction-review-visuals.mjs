#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const localRequire = createRequire(import.meta.url);
const { createServer } = await import(
  createRequire(localRequire.resolve("vitest/package.json")).resolve("vite")
);
const { default: react } = await import(
  createRequire(
    new URL("../apps/shadcn-registry/package.json", import.meta.url),
  ).resolve("@vitejs/plugin-react")
);
const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = process.env.TRANSACTION_REVIEW_SOURCE_ROOT
  ? resolve(process.env.TRANSACTION_REVIEW_SOURCE_ROOT)
  : root;
const fixtureRoot = resolve(root, "tests/transaction-review-browser");
const runtime = resolve(fixtureRoot, "runtime.tsx");
const fixtureMode =
  process.env.TRANSACTION_REVIEW_FIXTURE_MODE ??
  (sourceRoot === root ? "commit" : "legacy");
const artifacts = process.env.TRANSACTION_REVIEW_ARTIFACT_DIR
  ? resolve(process.env.TRANSACTION_REVIEW_ARTIFACT_DIR)
  : resolve(root, "output/playwright/transaction-review");
await mkdir(artifacts, { recursive: true });
const comparableArtifactNames = [
  "aave-usdc-light-wide.png",
  "aave-usdc-light-sidebar.png",
  "aave-usdc-dark-sidebar.png",
  "aave-usdc-light-narrow.png",
];

const server = await createServer({
  configFile: false,
  root: fixtureRoot,
  logLevel: "error",
  plugins: [
    react(),
    {
      name: "transaction-review-font",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url !== "/__geist.woff2") return next();
          response.setHeader("content-type", "font/woff2");
          response.end(
            await readFile(
              resolve(
                root,
                "apps/landing/public/assets/landing/home/fonts/geist-latin.woff2",
              ),
            ),
          );
        });
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: "../../lib/wallet-kit/use-action-capabilities",
        replacement: runtime,
      },
      { find: "../../lib/wallet-kit", replacement: runtime },
      {
        find: "../../lib/capabilities/skill-catalog",
        replacement: runtime,
      },
      { find: "@aomi-labs/react", replacement: runtime },
      {
        find: "@aomi-labs/client",
        replacement: resolve(fixtureRoot, "client.ts"),
      },
      { find: "@fixture-source", replacement: sourceRoot },
      {
        find: "@",
        replacement: resolve(sourceRoot, "apps/shadcn-registry/src"),
      },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [root, sourceRoot] },
  },
});

let browser;
try {
  await server.listen();
  if (process.env.TRANSACTION_REVIEW_SERVE_ONLY === "1") {
    console.log(`Transaction review fixture: ${pageUrl()}`);
    await new Promise(() => {});
  }
  browser = await chromium.launch({
    headless: true,
    channel: process.env.TRANSACTION_REVIEW_BROWSER_CHANNEL || "chrome",
  });
  const page = await browser.newPage({
    viewport: { width: 1355, height: 825 },
    deviceScaleFactor: 1.2,
    reducedMotion: "reduce",
    colorScheme: "light",
  });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(pageUrl(), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const sidebar = page.getByRole("complementary", { name: "Chat activity" });
  const sidebarPanel = sidebar.locator(":scope > div");
  const review = page.getByTestId("transaction-review");
  await review.waitFor();

  await assertText(sidebar, "Skills");
  await assertText(sidebar, "Aave");
  await assertText(sidebar, "Common Erc20");
  await assertText(sidebar, "Transactions");
  await assertText(sidebar, "Supply 100 USDC to Aave");
  await assertText(sidebar, "Approve USDC for Aave");
  await assertText(review, "USDC");
  await assertText(review, "−100");
  await assertText(review, "aBasUSDC");
  await assertText(review, "+100.000118");
  await assertText(review, "0xda65d4…fc3cf0");
  await assertText(review, "Estimated gas · 226,611 units");
  await assertText(review, "Transaction details");
  await assertText(review, "Simulation details");
  await review.getByRole("button", { name: "Reject", exact: true }).waitFor();
  await review
    .getByRole("button", {
      name: fixtureMode === "commit" ? "Submit 1 of 2" : "Submit",
      exact: true,
    })
    .waitFor();
  if (fixtureMode === "commit")
    await review
      .getByRole("button", { name: "Submit all", exact: true })
      .waitFor();
  if (fixtureMode === "commit") {
    assert.deepEqual(await fixtureEvidence(page), {
      mode: "commit",
      pendingActions: 0,
      commitIds: ["commit-1", "commit-2"],
      sourceIds: [1, 2],
      controllerCalls: { execute: [], reject: [] },
    });
  }
  assert.deepEqual(failures, []);
  if (fixtureMode === "commit") await assertSplitFits(review);

  await page.screenshot({
    path: resolve(artifacts, "aave-usdc-light-wide.png"),
    animations: "disabled",
  });
  await sidebarPanel.screenshot({
    path: resolve(artifacts, "aave-usdc-light-sidebar.png"),
    animations: "disabled",
  });

  await page.goto(pageUrl({ theme: "dark" }), {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => document.fonts.ready);
  await page
    .getByRole("complementary", { name: "Chat activity" })
    .locator(":scope > div")
    .screenshot({
      path: resolve(artifacts, "aave-usdc-dark-sidebar.png"),
      animations: "disabled",
    });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(pageUrl(), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const fixture = document.querySelector(
      '[data-testid="transaction-review-fixture"]',
    );
    const chat = document.querySelector("#fixture-chat");
    const mount = document.querySelector("#sidebar-fixture-mount");
    if (!fixture || !chat || !mount)
      throw new Error("Fixture shell is missing");
    fixture.style.display = "block";
    fixture.style.width = "390px";
    fixture.style.height = "844px";
    chat.style.display = "none";
    mount.style.width = "390px";
    mount.style.height = "844px";
  });
  await page.getByTestId("transaction-review").waitFor();
  await page.waitForTimeout(100);
  if (fixtureMode === "commit")
    await assertSplitFits(page.getByTestId("transaction-review"));
  await page.screenshot({
    path: resolve(artifacts, "aave-usdc-light-narrow.png"),
    animations: "disabled",
  });

  await page.setViewportSize({ width: 1355, height: 825 });
  if (fixtureMode === "commit") {
    await page.goto(pageUrl(), { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Submit 1 of 2", exact: true })
      .click();
    assert.deepEqual((await fixtureEvidence(page)).controllerCalls, {
      execute: ["commit-1"],
      reject: [],
    });
    await page.goto(pageUrl({ state: "recovery" }), {
      waitUntil: "networkidle",
    });
    const recovery = page.getByTestId("transaction-review");
    await assertText(
      recovery,
      "The wallet used a different nonce from the prepared transaction.",
    );
    await assertText(recovery, "Transaction: 0xdeadbeef");
    assert.equal(
      await recovery
        .getByRole("button", { name: "Submit 1 of 2", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await recovery
        .getByRole("button", { name: "Reject", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("complementary", { name: "Chat activity" })
      .locator(":scope > div")
      .screenshot({
        path: resolve(artifacts, "aave-usdc-recovery-sidebar.png"),
        animations: "disabled",
      });
  } else {
    await page.goto(pageUrl({ state: "failed" }), {
      waitUntil: "networkidle",
    });
    const failed = page.getByTestId("transaction-review");
    await assertText(
      failed,
      "Simulation reverted before the supply could execute.",
    );
    assert.equal(
      await failed.getByRole("button", { name: "Submit" }).count(),
      0,
    );
    await page
      .getByRole("complementary", { name: "Chat activity" })
      .locator(":scope > div")
      .screenshot({
        path: resolve(artifacts, "aave-usdc-failed-sidebar.png"),
        animations: "disabled",
      });
  }

  if (process.env.TRANSACTION_REVIEW_EXPECT_DIR) {
    const expected = resolve(process.env.TRANSACTION_REVIEW_EXPECT_DIR);
    for (const name of comparableArtifactNames) {
      assert.equal(
        digest(await readFile(resolve(artifacts, name))),
        digest(await readFile(resolve(expected, name))),
        `${name} differs from the preserved pre-extraction baseline`,
      );
    }
  }

  console.log(JSON.stringify({ artifacts, failures, state: "passed" }));
} finally {
  await browser?.close();
  await server.close();
}

function pageUrl(options = {}) {
  const url = new URL(server.resolvedUrls.local[0]);
  url.searchParams.set("mode", fixtureMode);
  for (const [name, value] of Object.entries(options)) {
    url.searchParams.set(name, value);
  }
  return url.href;
}

async function fixtureEvidence(page) {
  return page.evaluate(() => window.__transactionReviewFixture);
}

async function assertText(locator, value) {
  const text = await locator.textContent();
  assert.ok(
    text?.includes(value),
    `Expected rendered fixture to include ${value}`,
  );
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function assertSplitFits(review) {
  for (const name of ["Submit 1 of 2", "Submit all"]) {
    const fits = await review
      .getByRole("button", { name, exact: true })
      .evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(button);
        const content = range.getBoundingClientRect();
        return (
          content.left >= bounds.left + 4 && content.right <= bounds.right - 4
        );
      });
    assert.equal(
      fits,
      true,
      `${name} must fit inside its segment with padding`,
    );
  }
}
