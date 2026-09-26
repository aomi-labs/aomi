#!/usr/bin/env node
// Deterministic rendered UI qualification using the existing Vite/Playwright lane.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
const require = createRequire(import.meta.url);
const { createServer } = await import(
  createRequire(require.resolve("vitest/package.json")).resolve("vite")
);
const { default: react } = await import(
  require.resolve("@vitejs/plugin-react")
);
const { default: tailwind } = await import(
  require.resolve("@tailwindcss/postcss")
);
const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "output/playwright/transaction-safety");
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: resolve(root, "tests/transaction-safety-browser"),
  logLevel: "error",
  plugins: [
    react(),
    {
      name: "safety-wallet-fixture",
      resolveId(id) {
        if (id.endsWith("lib/wallet-kit/context"))
          return resolve(root, "tests/transaction-safety-browser/wallet.ts");
      },
    },
  ],
  resolve: {
    alias: {
      "@": resolve(root, "apps/shadcn-registry/src"),
      "@aomi-labs/client": resolve(root, "packages/client/src/index.ts"),
      "@aomi-labs/react": resolve(
        root,
        "tests/transaction-safety-browser/runtime.tsx",
      ),
    },
  },
  css: { postcss: { plugins: [tailwind()] } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
});
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.COMMIT_BROWSER_CHANNEL || "chrome",
  });
  for (const dark of [false, true])
    for (const width of [352, 900]) {
      const page = await browser.newPage({
        viewport: { width: Math.max(width, 400), height: 900 },
        reducedMotion: "reduce",
      });
      const failures = [];
      page.on("pageerror", (error) => failures.push(error.message));
      let mode = "balanced",
        revision = 3,
        writes = 0;
      await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path.includes("onchain-policies"))
          return route.fulfill({
            status: 503,
            json: { error: "Swig unavailable in this fixture" },
          });
        if (path === "/api/account")
          return route.fulfill({
            json: { signing_policies: [], delegated_accounts: [] },
          });
        if (path.endsWith("transaction-safety")) {
          if (request.method() === "PUT") {
            const body = request.postDataJSON();
            assert.equal(body.expectedRevision, revision);
            assert.equal(request.headers()["x-thread-id"], "browser-chat");
            mode = body.mode;
            revision++;
            writes++;
          }
          return route.fulfill({
            json: {
              mode: path.includes("/thread/") ? mode : "balanced",
              revision: path.includes("/thread/") ? revision : 1,
              scope: path.includes("/thread/") ? "thread" : "account_default",
              source: "user",
            },
          });
        }
        return route.fulfill({
          status: 404,
          json: { error: "Unsupported fixture endpoint" },
        });
      });
      await page.goto(
        `${server.resolvedUrls.local[0]}?width=${width}&dark=${dark ? 1 : 0}`,
      );
      await page.getByRole("radio", { name: /Balanced/ }).waitFor();
      assert.equal(
        await page.getByRole("radio", { name: /Balanced/ }).isChecked(),
        true,
      );
      const balanced = page.getByRole("radio", { name: /Balanced/ });
      await balanced.focus();
      await page.keyboard.press("ArrowRight");
      const danger = page.getByRole("radio", { name: /Danger mode/ });
      assert.equal(await danger.isChecked(), true);
      assert.equal(
        await danger.evaluate((element) => element === document.activeElement),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Set default for new chats" })
          .isEnabled(),
        false,
      );
      await page.getByRole("button", { name: "Save for this chat" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Enable Danger mode for this chat?",
      });
      await dialog.waitFor();
      assert.equal(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
        true,
      );
      for (let tab = 0; tab < 5; tab++) {
        await page.keyboard.press("Tab");
        assert.equal(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          true,
        );
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await expect(
        page.getByRole("button", { name: "Save for this chat" }),
      ).toBeFocused();
      assert.equal(writes, 0);
      await page.keyboard.press("Enter");
      await dialog.waitFor();
      assert.equal(writes, 0);
      await page.getByRole("button", { name: "Enable Danger mode" }).click();
      await page
        .getByText(
          "Safety policy saved for this chat. Future actions use this selection.",
        )
        .waitFor();
      assert.equal(writes, 1);
      await page
        .getByRole("button", { name: "Show all 14 transactions" })
        .click();
      const cards = page.getByTestId("activity-transaction");
      assert.equal(await cards.count(), 14);
      for (let i = 0; i < 14; i++)
        assert.equal((await cards.nth(i).boundingBox()).height, 84);
      assert.equal(await cards.getByRole("button").count(), 0);
      assert.equal(await page.getByText("Assessment not recorded").count(), 0);
      const mixed = page.locator('section[aria-label="Mixed cohort"]');
      assert.equal(
        await mixed.getByRole("button", { name: "Submit all" }).isEnabled(),
        false,
      );
      assert.equal(
        await page
          .locator('section[aria-label="Danger review"]')
          .getByRole("button", { name: "Submit" })
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator('section[aria-label="Recovery"]')
          .getByRole("button", { name: "Check status" })
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator('section[aria-label="Recovery"]')
          .getByRole("button", { name: "Submit" })
          .count(),
        0,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: resolve(output, `${dark ? "dark" : "light"}-${width}.png`),
        fullPage: true,
      });
      assert.deepEqual(failures, []);
      const accessible = await page.locator("main").ariaSnapshot();
      assert.ok(accessible.includes("Transaction safety mode"));
      assert.ok(accessible.includes("Save for this chat"));
      assert.ok(accessible.includes("Check status"));
      assert.ok(accessible.includes("Submit all"));
      await page
        .getByRole("region", {
          name: "Transactions, newest batch first; signing order within each batch",
        })
        .focus();
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("role")),
        "region",
      );
      assert.equal(
        await page.evaluate(
          () =>
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.playState === "running" &&
                  animation.effect?.target?.closest?.(
                    '[data-testid="activity-transaction"]',
                  ),
              ).length,
        ),
        0,
      );
      results.push({
        dark,
        width,
        writes,
        statuses: 14,
        keyboard: "radio arrows, dialog trap, Escape restore, Enter",
        accessibleNames: "verified ARIA tree and region/button names",
        reducedMotion: "reduce with no running card animations",
        status: "passed",
      });
      await page.close();
    }
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify(
      {
        cases: results,
        scope:
          "Actual settings/cards/reviews with deterministic backend fixtures; no wallet invocation or live backend integration",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  await server.close();
}
