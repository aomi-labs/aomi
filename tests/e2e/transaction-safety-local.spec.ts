import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { signInThroughUi, portalAccount } from "./browser-contract-helpers";
import { fixtureKeys } from "./fixture-wallets";

type Policy = {
  mode: "guarded_only" | "balanced" | "unrestricted";
  revision: number;
  scope: "thread" | "account_default";
  source: "default" | "user";
};
const accountPath = "/v1/account/transaction-safety";

async function request(
  page: Page,
  path: string,
  body?: { mode: Policy["mode"]; expectedRevision: number },
) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: body ? "PUT" : "GET",
        headers: body
          ? { "Content-Type": "application/json", "X-Aomi-CSRF": "1" }
          : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    { path, body },
  );
}

async function settings(page: Page) {
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Safety", exact: true }).click();
  await expect(
    dialog.getByRole("radiogroup", { name: "Guard policy" }),
  ).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page, baseURL }) => {
  await signInThroughUi(page, {
    family: "evm",
    pageOrigin: baseURL!,
    challengeOrigin: baseURL!,
    privateKeys: [fixtureKeys.evm[0]!],
  });
  expect((await portalAccount(page)).user?.id).toBeTruthy();
});

test("settings preserve account defaults and reject account Yolo through the real backend", async ({
  page,
}, info) => {
  const before = await request(page, accountPath);
  expect(before.status).toBe(200);
  const dialog = await settings(page);
  const target = before.body.mode === "balanced" ? "guarded_only" : "balanced";
  const label = target === "balanced" ? "Balanced" : "Strict";
  await expect(
    dialog.getByRole("radio", { name: "Yolo", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("radio", { name: label, exact: true }).click();
  await expect
    .poll(async () => (await request(page, accountPath)).body)
    .toEqual({
      mode: target,
      revision: before.body.revision + 1,
      scope: "account_default",
      source: "user",
    });
  await page.screenshot({
    path: info.outputPath("settings-saved.png"),
    fullPage: true,
  });
  const forbidden = await request(page, accountPath, {
    mode: "unrestricted",
    expectedRevision: before.body.revision + 1,
  });
  expect(forbidden.status).toBe(400);
  await page.reload();
  const reloaded = await settings(page);
  await expect(
    reloaded.getByRole("radio", { name: label, exact: true }),
  ).toHaveAttribute("aria-checked", "true");
});

test("thread snapshot and CAS survive account changes, and draft Yolo needs confirmation", async ({
  page,
}, info) => {
  const account = (await request(page, accountPath)).body as Policy;
  const threadPath = `${accountPath}/threads/${randomUUID()}`;
  const draft = await request(page, threadPath);
  expect(draft).toEqual({
    status: 200,
    body: { ...account, scope: "thread", source: "default" },
  });
  const saved = await request(page, threadPath, {
    mode: "unrestricted",
    expectedRevision: draft.body.revision,
  });
  expect(saved).toEqual({
    status: 200,
    body: {
      mode: "unrestricted",
      revision: draft.body.revision + 1,
      scope: "thread",
      source: "user",
    },
  });
  const changed = await request(page, accountPath, {
    mode: account.mode === "balanced" ? "guarded_only" : "balanced",
    expectedRevision: account.revision,
  });
  expect(changed.status).toBe(200);
  expect(await request(page, threadPath)).toEqual(saved);
  const conflicting = await request(page, threadPath, {
    mode: "balanced",
    expectedRevision: draft.body.revision,
  });
  expect(conflicting.status).toBe(409);
  expect(await request(page, threadPath)).toEqual(saved);

  await page.reload();
  const selector = page.getByRole("combobox", { name: /^Guard policy:/ });
  await expect(selector).toBeEnabled();
  const originalLabel = await selector.getAttribute("aria-label");
  await selector.click();
  await page.getByRole("button", { name: /^Yolo/ }).click();
  await expect(
    page.getByRole("button", { name: "Turn on", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("yolo-confirmation.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(selector).toHaveAttribute("aria-label", originalLabel!);
  await selector.click();
  await page.getByRole("button", { name: /^Yolo/ }).click();
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  await expect(selector).toHaveAttribute("aria-label", "Guard policy: Yolo");
  expect((await request(page, accountPath)).body).toEqual(changed.body);
  await page.screenshot({
    path: info.outputPath("draft-yolo.png"),
    fullPage: true,
  });
});

test("a second session wins the revision race and the settings UI reloads without retrying", async ({
  page,
  browser,
  baseURL,
}, info) => {
  const before = (await request(page, accountPath)).body as Policy;
  const dialog = await settings(page);
  const target = before.mode === "balanced" ? "guarded_only" : "balanced";
  const label = target === "balanced" ? "Balanced" : "Strict";
  const other = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  try {
    const second = await other.newPage();
    await second.goto(baseURL!);
    expect(
      (
        await request(second, accountPath, {
          mode: target,
          expectedRevision: before.revision,
        })
      ).status,
    ).toBe(200);
    const writes: number[] = [];
    page.on("response", (response) => {
      if (
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname.includes("transaction-safety")
      )
        writes.push(response.status());
    });
    await dialog.getByRole("radio", { name: label, exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(
      dialog.getByRole("radio", { name: label, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    expect(writes).toEqual([409]);
    expect((await request(page, accountPath)).body.revision).toBe(
      before.revision + 1,
    );
    await page.screenshot({
      path: info.outputPath("revision-conflict.png"),
      fullPage: true,
    });
  } finally {
    await other.close();
  }
});

test("the first message waits for the held thread choice to be saved", async ({
  page,
}, info) => {
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const order: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (
      response.request().method() === "PUT" &&
      path.includes("transaction-safety")
    ) {
      expect(response.status()).toBe(200);
      order.push("saved");
    }
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/agent/chat"
    )
      order.push("sent");
  });
  const selector = page.getByRole("combobox", { name: /^Guard policy:/ });
  await expect(selector).toBeEnabled();
  await selector.click();
  await page.getByRole("button", { name: /^Yolo/ }).click();
  await page.getByRole("button", { name: "Turn on", exact: true }).click();
  expect(order).toEqual([]);
  await page
    .getByRole("textbox", { name: "Message input" })
    .fill("Reply with hello. Do not use tools or execute transactions.");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.includes("transaction-safety"),
  );
  const sent = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/agent/chat" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const savedPolicy = await (await saved).json();
  expect((await sent).status()).toBe(200);
  expect(order).toEqual(["saved", "sent"]);
  expect(savedPolicy).toMatchObject({
    mode: "unrestricted",
    scope: "thread",
    source: "user",
  });
  await page.screenshot({
    path: info.outputPath("first-send-saved.png"),
    fullPage: true,
  });
});
