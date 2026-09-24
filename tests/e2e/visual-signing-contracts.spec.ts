import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  fixtureKeys,
  requiredOrigin,
  resetContractState,
  sendPrompt,
  signInThroughUi,
  upstreamRecords,
} from "./browser-contract-helpers";

const portalOrigin = requiredOrigin("BROWSER_CONTRACT_PORTAL_URL");
const keys = fixtureKeys();
const fixedNow = new Date("2026-09-16T12:00:00.000Z");
const actionPrompt = "prepare the deterministic wallet review";

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000);
  await resetContractState();
  await page.clock.setFixedTime(fixedNow);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("signed-in chat, account, settings, and usage surfaces match visual contracts", async ({
  page,
}) => {
  await signIn(page);
  await settleVisuals(page);
  await expect(page).toHaveScreenshot("signed-in-new-chat.png", screenshot());

  await sendPrompt(page, "visual completed trace");
  await settleVisuals(page);
  await expect(page).toHaveScreenshot("completed-chat.png", screenshot());

  await page.getByRole("button", { name: "Open account menu" }).click();
  const menu = page.getByRole("menu", { name: "Account menu" });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveScreenshot("account-menu.png", screenshot());

  await menu.getByRole("button", { name: "Manage account" }).click();
  const accountSettings = page.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await expect(accountSettings).toBeVisible();
  await settleVisuals(page);
  await expect(accountSettings).toHaveScreenshot(
    "account-settings.png",
    screenshot(),
  );
  await accountSettings.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("button", { name: "Open account menu" }).click();
  await page
    .getByRole("menu", { name: "Account menu" })
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(settings.getByText("Monthly credits")).toBeVisible({
    timeout: 30_000,
  });
  await settleVisuals(page);
  await expect(settings).toHaveScreenshot("usage-settings.png", screenshot());
});

test("wallet handoff failure, rejection, replay, and reload preserve one durable Action", async ({
  page,
}) => {
  const { wallet } = await signIn(page);
  await sendPrompt(page, actionPrompt, {
    expectReply: false,
    expectComposerReady: false,
  });

  const sidebar = page.getByRole("complementary", { name: "Chat activity" });
  const review = sidebar.getByTestId("transaction-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(review).toContainText("0.000000000000000001 ETH");
  await expect(review.getByRole("button", { name: "Submit" })).toBeEnabled();
  await assertSidebarDoesNotCoverComposer(page, sidebar);
  await settleVisuals(page);
  await expect(sidebar).toHaveScreenshot(
    "pending-wallet-review.png",
    screenshot(),
  );

  await review.getByRole("button", { name: "Submit" }).click();
  await expect.poll(() => wallet.blocked.length, { timeout: 15_000 }).toBe(1);
  await expect(
    page.getByText(/signing and broadcasting are forbidden/i),
  ).toBeVisible();
  expect(
    (await upstreamRecords()).filter((record) =>
      record.path.includes("/actions/"),
    ),
  ).toHaveLength(0);
  await expect(review).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await openActionThread(page);
  await expect(page.getByTestId("transaction-review")).toBeVisible({
    timeout: 30_000,
  });

  const resultResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/v1\/agent\/chat\/[^/]+\/actions\/[^/]+\/result$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const response = await resultResponse;
  expect(response.status()).toBe(200);
  const original = response.request();
  const endpoint = new URL(original.url()).pathname;
  const idempotencyKey = original.headers()["idempotency-key"];
  expect(idempotencyKey).toBeTruthy();
  const originalBody = JSON.parse(original.postData() ?? "{}");

  await expect(page.getByTestId("transaction-review")).toHaveCount(0);
  const rejected = page.locator('[aria-label$="signing: rejected"]');
  await expect(rejected).toHaveCount(1);
  await settleVisuals(page);
  await expect(sidebar).toHaveScreenshot(
    "rejected-wallet-history.png",
    screenshot(),
  );

  const replay = await page.evaluate(
    async ({ endpoint, idempotencyKey, body }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { endpoint, idempotencyKey: idempotencyKey!, body: originalBody },
  );
  expect(replay.status).toBe(200);
  expect(replay.body.action).toMatchObject({ revision: 2, state: "rejected" });

  const stale = await page.evaluate(
    async ({ endpoint, body }) => {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "fixture-stale-revision",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { endpoint, body: originalBody },
  );
  expect(stale).toEqual({
    status: 409,
    body: { error: { code: "stale_action_revision" } },
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await openActionThread(page);
  await expect(page.getByTestId("transaction-review")).toHaveCount(0);
  await expect(page.locator('[aria-label$="signing: rejected"]')).toHaveCount(
    1,
  );
  await expect(page.getByTestId("activity-transaction")).toHaveCount(1);
});

async function openActionThread(page: Page): Promise<void> {
  await page.getByRole("button", { name: actionPrompt, exact: true }).click();
}

async function signIn(page: Page) {
  return signInThroughUi(page, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
  });
}

async function settleVisuals(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function assertSidebarDoesNotCoverComposer(
  page: Page,
  sidebar: Locator,
): Promise<void> {
  const composer = page.getByRole("textbox", { name: "Message input" });
  await expect(composer).toBeVisible();
  const [sidebarBox, composerBox] = await Promise.all([
    sidebar.boundingBox(),
    composer.boundingBox(),
  ]);
  expect(sidebarBox).toBeTruthy();
  expect(composerBox).toBeTruthy();
  const overlaps =
    sidebarBox!.x < composerBox!.x + composerBox!.width &&
    sidebarBox!.x + sidebarBox!.width > composerBox!.x &&
    sidebarBox!.y < composerBox!.y + composerBox!.height &&
    sidebarBox!.y + sidebarBox!.height > composerBox!.y;
  expect(overlaps).toBe(false);
}

function screenshot() {
  return {
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "css" as const,
    maxDiffPixelRatio: 0.002,
  };
}
