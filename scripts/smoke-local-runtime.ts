/** Exercise the packed CLI and unmocked browser against an explicit local stack. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "@playwright/test";

const origin = localOrigin("AOMI_LOCAL_SMOKE_ORIGIN");
const backend = localOrigin("AOMI_LOCAL_SMOKE_BACKEND");
const output = "output/local-runtime";
mkdirSync(output, { recursive: true });
const state = mkdtempSync(join(tmpdir(), "aomi-cli-smoke-"));
const evidence: Record<string, unknown> = {
  origin,
  backend,
  transport: "real local Rust; no route interception",
};
const command = (args: string[], entry = "packages/cli/dist/bin.js") => {
  const result = spawnSync(
    process.execPath,
    [entry, ...args, "--backend-url", origin, "--json"],
    {
      encoding: "utf8",
      timeout: 90_000,
      env: { ...process.env, AOMI_STATE_DIR: state },
    },
  );
  // Never include arguments, private state, or command output in failure logs.
  assert.equal(
    result.status,
    0,
    `CLI ${args[0]} ${args[1] ?? ""} failed (exit ${result.status})`,
  );
  return JSON.parse(result.stdout);
};
try {
  assert.equal((await fetch(`${backend}/health`)).status, 200);
  evidence.health = 200;
  const login = command([
    "account",
    "login",
    "--wallet",
    "--private-key",
    `0x${randomBytes(32).toString("hex")}`,
  ]);
  assert.equal(login.status, "signed_in");
  const ttl = Date.parse(login.expiresAt) - Date.now();
  assert.ok(ttl > 23.9 * 60 * 60 * 1000 && ttl <= 24 * 60 * 60 * 1000);
  evidence.cliSessionHours = Math.round(ttl / 3_600_000);
  const who = command(["account", "whoami"]);
  const links = command(["account", "links"]);
  assert.ok(links.user?.id, "canonical account graph missing");
  assert.ok(links.wallets.length, "verified SIWE wallet missing");
  evidence.canonicalAccountId = links.user.id;
  assert.equal(who.user?.id, links.user.id);
  evidence.whoami = "pass";
  evidence.walletLinks = links.wallets.length;
  command(["session", "list"]);
  evidence.remoteSessionList = "pass";
  const guard = command(["guard", "--account"]);
  assert.ok(["guarded_only", "balanced"].includes(guard.mode));
  const savedGuard = command(["guard", guard.mode, "--account"]);
  assert.equal(savedGuard.mode, guard.mode);
  assert.equal(command(["guard", "--account"]).mode, guard.mode);
  evidence.authoritativeGuardReadWrite = "pass";
  command(["byok", "list"]);
  evidence.maskedByokRead = "pass";
  command(["account", "statement"]);
  evidence.statement = "pass";
  command(["account", "links"], "packages/cli/dist/bin.js");
  evidence.legacyCli = "pass";
  const activeId = readFileSync(
    join(state, "active-session.txt"),
    "utf8",
  ).trim();
  assert.match(activeId, /^\d+$/, "CLI active session index missing");
  // Signing in rotates away from the old guest-owned thread. Verify the
  // credential of the active thread, rather than the first historical file.
  const saved = JSON.parse(
    readFileSync(join(state, "sessions", `session-${activeId}.json`), "utf8"),
  );
  const token = saved.auth?.sessionToken ?? saved.state?.auth?.sessionToken;
  assert.ok(token, "CLI persisted session missing");
  const headers = { Authorization: `Bearer ${token}` };
  const account = await fetch(`${origin}/v1/account`, { headers });
  assert.equal(account.status, 200);
  assert.equal((await account.json()).user.id, links.user.id);
  const profile = await fetch(`${origin}/api/account`, { headers });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.user_id, links.user.id);
  evidence.backendCanonicalIdentity = "pass";
  const unauthorized = await fetch(`${origin}/v1/account`, {
    headers: { Authorization: "Bearer malformed" },
  });
  assert.equal(unauthorized.status, 401);
  evidence.invalidExplicitCredential = 401;

  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROME_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE }
      : {}),
  });
  try {
    const context = await browser.newContext();
    await context.addInitScript(() =>
      localStorage.setItem("aomi-cookie-consent", "declined"),
    );
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const agentStatuses: number[] = [];
    evidence.agentStatuses = agentStatuses;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/v1/agent/chat"))
        agentStatuses.push(response.status());
    });
    const navigationStarted = Date.now();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const accept = page.getByRole("button", {
      name: "Accept all",
      exact: true,
    });
    if (await accept.isVisible()) await accept.click();
    const input = page.getByTestId("aomi-composer-input");
    await input.waitFor({ state: "visible", timeout: 60_000 });
    evidence.composerVisibleMs = Date.now() - navigationStarted;
    await page
      .getByRole("combobox")
      .filter({ hasText: "Auto" })
      .first()
      .click();
    const model = process.env.AOMI_LOCAL_SMOKE_MODEL || "GPT-6 Luna";
    await page.getByRole("option", { name: model, exact: true }).click();
    evidence.model = model;
    await input.fill("Reply with exactly LOCAL_RUNTIME_OK. Do not use tools.");
    const sendStarted = Date.now();
    await page.getByTestId("aomi-send").click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid="aomi-assistant-message"]')]
          .some((message) => /LOCAL_/.test(message.textContent ?? "")),
      undefined,
      { timeout: 180_000 },
    );
    evidence.sendToFirstReplyMs = Date.now() - sendStarted;
    await page
      .getByTestId("aomi-assistant-message")
      .filter({ hasText: "LOCAL_RUNTIME_OK" })
      .first()
      .waitFor({ state: "visible", timeout: 180_000 });
    evidence.sendToExpectedReplyMs = Date.now() - sendStarted;
    await page
      .getByTestId("aomi-stop")
      .waitFor({ state: "hidden", timeout: 60_000 });
    assert.equal(pageErrors.length, 0, "browser page errors");
    assert.ok(
      agentStatuses.includes(200),
      "actual local chat request never succeeded",
    );
    assert.ok(
      agentStatuses.every((status) => status === 200),
      "fresh guest chat needed an auth retry or failed stream",
    );
    await page.screenshot({ path: `${output}/real-guest.png`, fullPage: true });
    evidence.realGuestChat = "pass";
    evidence.agentStatuses = agentStatuses;
    evidence.pageErrors = pageErrors.length;
    evidence.timingScope =
      "fresh anonymous browser on managed dev Portal; actual Rust/provider; model selected before send";
    await context.close();
  } finally {
    await browser.close();
  }
  command(["account", "logout"]);
  evidence.result = "pass";
} catch (error) {
  evidence.result = "fail";
  evidence.error = error instanceof Error ? error.message : "unknown error";
  throw error;
} finally {
  writeFileSync(
    `${output}/results.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  rmSync(state, { recursive: true, force: true });
}
console.log(JSON.stringify(evidence, null, 2));
function localOrigin(name: string): string {
  const url = new URL(process.env[name] ?? "");
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    `${name} must select a local stack`,
  );
  return url.origin;
}
