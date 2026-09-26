#!/usr/bin/env node
// Connected local settings proof using the supported disposable E2E wallet route.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const origin =
  process.env.AOMI_SAFETY_BROWSER_ORIGIN ?? "http://localhost:3006";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
assert.ok(
  process.env.AOMI_SAFETY_BROWSER_TOKEN_FILE,
  "Private local token file required",
);
const privateContents = (
  await readFile(process.env.AOMI_SAFETY_BROWSER_TOKEN_FILE, "utf8")
).trim();
const token = (
  privateContents.match(/^AOMI_E2E_WALLET_TOKEN=(.+)$/m)?.[1] ?? privateContents
)
  .trim()
  .replace(/^(["'])(.*)\1$/, "$2");
assert.ok(token);
const wallet = `0x${randomBytes(20).toString("hex")}`;
const output = resolve("output/playwright/transaction-safety-connected");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 900 },
    reducedMotion: "reduce",
  });
  const seed = new URL("/api/bff/e2e/wallet", origin);
  seed.searchParams.set("token", token);
  seed.searchParams.set("address", wallet);
  seed.searchParams.set("chainId", "1");
  let response;
  try {
    response = await context.request.get(seed.toString(), { maxRedirects: 0 });
  } catch {
    throw new Error("Disposable local identity setup failed");
  }
  assert.equal(
    response.status(),
    307,
    "Supported E2E identity route must accept the task token",
  );
  const page = await context.newPage();
  const writes = [];
  page.on("response", async (response) => {
    const request = response.request();
    if (
      request.method() !== "PUT" ||
      !new URL(request.url()).pathname.endsWith("transaction-safety")
    )
      return;
    writes.push({
      status: response.status(),
      body: request.postDataJSON(),
      threadId: request.headers()["x-thread-id"],
    });
  });
  await page.goto(origin);
  const decline = page.getByRole("button", { name: "Decline" });
  if (await decline.count()) await decline.click();
  try {
    await page.getByRole("button", { name: "Open settings" }).click({ timeout: 15000 });
  } catch {
    await page.screenshot({ path: resolve(output, "settings-entry-failure.png"), fullPage: true });
    await writeFile(resolve(output, "settings-entry-failure.json"), JSON.stringify({
      status: "failed_before_settings",
      headings: await page.getByRole("heading").allTextContents(),
      buttons: await page.getByRole("button").allTextContents(),
      body: (await page.locator("body").innerText()).slice(0, 6000),
    }, null, 2));
    throw new Error("Authenticated portal did not expose the settings entry; sanitized local artifact saved");
  }
  await page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name: "Policy", exact: true })
    .click();
  const guarded = page.getByRole("radio", { name: /Guarded only/ });
  const balanced = page.getByRole("radio", { name: /Balanced/ });
  await guarded.waitFor();
  await page.waitForFunction(() => {
    const radios = [
      ...document.querySelectorAll('input[name="transaction-safety"]'),
    ];
    return radios.some((input) => input.checked && !input.disabled);
  });
  const target = (await guarded.isChecked()) ? balanced : guarded;
  await target.check();
  const save = page.getByRole("button", { name: "Save for this chat" });
  await save.click();
  await page
    .getByText(
      "Safety policy saved for this chat. Future actions use this selection.",
    )
    .waitFor();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, 200);
  assert.ok(writes[0].threadId, "Real runtime thread identity required");
  assert.equal(typeof writes[0].body.expectedRevision, "number");
  await page.getByRole("radio", { name: /Danger mode/ }).check();
  assert.equal(
    await page
      .getByRole("button", { name: "Set default for new chats" })
      .isEnabled(),
    false,
  );
  await save.click();
  await page.getByRole("dialog", { name: /Enable Danger mode/ }).waitFor();
  assert.equal(
    writes.length,
    1,
    "Opening confirmation must not write the policy",
  );
  await page
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  assert.equal(writes.length, 1);
  assert.equal(
    await page.getByRole("heading", { name: "On-chain permissions" }).count(),
    1,
  );
  await page.screenshot({
    path: resolve(output, "settings-missing-swig.png"),
    fullPage: true,
  });
  await writeFile(
    resolve(output, "results.json"),
    JSON.stringify(
      {
        status: "passed",
        scope:
          "Real local frontend/BFF/backend policy read and CAS write using a disposable EVM-only identity; no Swig binding, wallet send, or model journey",
        writes: writes.map(({ status, body, threadId }) => ({
          status,
          mode: body.mode,
          expectedRevision: body.expectedRevision,
          threadId,
        })),
      },
      null,
      2,
    ),
  );
  console.log(
    "Connected local safety settings passed with one authoritative policy write.",
  );
  await context.close();
} finally {
  await browser.close();
}
