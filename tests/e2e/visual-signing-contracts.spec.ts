import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  fixtureKeys,
  requiredOrigin,
  resetContractState,
  sendPrompt,
  signInThroughUi,
  upstreamRecords,
} from "./browser-contract-helpers";

import {
  callbackEvents,
  callbackFinalText,
} from "../fixtures/commit-callback-events";

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

test("controlled delayed child activity keeps the answer and a scrolled-up reader in place", async ({
  page,
}) => {
  await signIn(page);
  const prompt = "controlled delayed child browser fixture";
  const turnId = "controlled-active-turn";
  const agentId = "controlled-child-agent";
  const callId = "controlled-child-call";
  let sequence = 0;
  const event = (
    type: string,
    data: Record<string, unknown>,
    turn = turnId,
  ) => ({
    turn_id: turn,
    event_id: `controlled-${++sequence}`,
    occurred_at: fixedNow.getTime() / 1_000,
    sequence,
    type,
    ...data,
  });
  const history = Array.from({ length: 12 }, (_, index) => [
    event(
      "message",
      {
        sender: "user",
        content: `Earlier question ${index + 1}`,
        message_key: `earlier-user-${index}`,
      },
      `earlier-${index}`,
    ),
    event(
      "message",
      {
        sender: "agent",
        content: `Earlier answer ${index + 1}. ${"A readable prior result. ".repeat(8)}`,
        message_key: `earlier-answer-${index}`,
      },
      `earlier-${index}`,
    ),
  ]).flat();
  const initial = [
    ...history,
    event("message", {
      sender: "user",
      content: prompt,
      message_key: "controlled-user",
    }),
    event("message", {
      sender: "agent",
      content: "Controlled progress stays visible while the child works.",
      message_key: "controlled-progress",
    }),
    event("task_started", {
      call_id: callId,
      agent_id: agentId,
      label: "Controlled child",
      app: "default",
      resumed: false,
    }),
    event("turn_state_changed", { state: "processing" }),
  ];
  const firstChild = event("task_activity", {
    call_id: callId,
    agent_id: agentId,
    child_seq: 1,
    kind: "tool_call",
    tool_name: "get_chain_context",
    args: null,
    result_preview: "Context ready",
  });
  const secondChild = event("task_activity", {
    call_id: callId,
    agent_id: agentId,
    child_seq: 2,
    kind: "tool_call",
    tool_name: "estimate_fee",
    args: null,
    result_preview: "Fee ready",
  });
  const finished = [
    event("task_completed", {
      call_id: callId,
      agent_id: agentId,
      app: "default",
      status: "completed",
      message: "Child finished",
      staged_count: 0,
      steps: 2,
      duration_ms: 2_000,
    }),
    event("message", {
      sender: "agent",
      content: "Controlled final answer is ready.",
      message_key: "controlled-final",
    }),
    event("turn_state_changed", { state: "complete" }),
  ];
  const pages = [[firstChild], [firstChild, secondChild], finished];
  const gates = pages.map(() => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ready, release };
  });
  let sessionId = "";
  let streamNumber = 0;
  await page.route("**/v1/agent/chat", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as {
      sessionId?: string;
      message?: string;
    };
    if (body.message !== prompt) return route.continue();
    sessionId = body.sessionId ?? "";
    expect(sessionId).toBeTruthy();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session_id: sessionId,
        cursor: String(initial.at(-1)!.sequence),
        events: initial,
        has_more: false,
      }),
    });
  });
  await page.route(
    /\/v1\/agent\/chat\/[^/]+\/stream(?:\?|$)/,
    async (route) => {
      const index = streamNumber++;
      if (index >= pages.length) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: "",
        });
        return;
      }
      await gates[index]!.ready;
      const events = pages[index]!;
      const pageData = {
        session_id: sessionId,
        cursor: String(events.at(-1)!.sequence),
        events,
        has_more: false,
      };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: page\ndata: ${JSON.stringify(pageData)}\n\n`,
      });
    },
  );

  await sendPrompt(page, prompt, {
    expectReply: false,
    expectComposerReady: false,
  });
  const trace = page.locator(".aui-working-trace").last();
  await expect(trace).toContainText("Controlled progress stays visible");
  await expect(
    page
      .locator(".aui-working-answer")
      .filter({ hasText: "Controlled progress" }),
  ).toHaveCount(0);
  gates[0]!.release();
  await expect(trace).toContainText("Get chain context");
  await expect(trace.locator(".aui-working-trace-header")).toContainText(
    "3 steps",
  );

  const viewport = page.locator(".aui-thread-viewport");
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.clientHeight,
      ),
    )
    .toBeGreaterThan(100);
  await viewport.evaluate((element) => {
    element.scrollTop = 80;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBe(80);
  const before = await viewport.evaluate((element) => element.scrollTop);

  gates[1]!.release();
  await expect(trace).toContainText("Estimate fee");
  await expect(trace.locator(".aui-working-trace-header")).toContainText(
    "4 steps",
  );
  await expect(trace).toContainText("Controlled progress stays visible");
  const after = await viewport.evaluate((element) => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(4);

  gates[2]!.release();
  await expect(
    page
      .locator(".aui-working-answer")
      .filter({ hasText: "Controlled final answer is ready." }),
  ).toHaveCount(1);
});

test("saved wallet callback reload reuses tool resources and unlocks the same session after completion", async ({
  page,
}) => {
  await signIn(page);
  const sessionId = "saved-callback-browser-contract";
  const title = "Saved callback preparation";
  let completed = false;
  let release!: () => void;
  const terminalGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pageData = (events: typeof callbackEvents) => ({
    session_id: sessionId,
    cursor: String(events.at(-1)?.sequence ?? 0),
    events,
    has_more: false,
  });
  await page.route("**/v1/agent/sessions**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: [
          {
            id: sessionId,
            title,
            updatedAt: fixedNow.getTime(),
            archived: false,
          },
        ],
        nextCursor: null,
      }),
    }),
  );
  await page.route(
    /\/v1\/agent\/chat\/saved-callback-browser-contract(?:\?|$)/,
    (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          pageData(
            cursor
              ? []
              : callbackEvents.filter(
                  (event) => completed || event.sequence < 32,
                ),
          ),
        ),
      });
    },
  );
  await page.route(
    /\/v1\/agent\/chat\/saved-callback-browser-contract\/stream(?:\?|$)/,
    async (route) => {
      await terminalGate;
      completed = true;
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: page\ndata: ${JSON.stringify(pageData(callbackEvents.filter((event) => event.sequence === 32)))}\n\n`,
      });
    },
  );
  // Restore an existing saved session; no new model turn or wallet action.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: title, exact: true }).click();
  const trace = page.locator(".aui-working-trace");
  await expect(trace).toContainText(callbackFinalText, { timeout: 30_000 });
  await expect(page.locator(".aui-working-answer")).toHaveCount(0);
  await expect(trace.locator(".aui-working-step")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toBeVisible();
  await expect(page.getByText(/Duplicate key|Runtime Error/i)).toHaveCount(0);
  expect(errors).toEqual([]);

  const unsentDraft = "Yes, proceed with the prepared transactions.";
  await page.getByRole("textbox", { name: "Message input" }).fill(unsentDraft);
  release();
  const answer = page.locator(".aui-working-answer");
  await expect(answer).toHaveCount(1);
  await expect(answer).toHaveText(callbackFinalText);
  await expect(trace).toContainText(
    "I will stage the approval and supply in order.",
  );
  await expect(trace).not.toContainText(callbackFinalText);
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();

  await expect(page.getByRole("textbox", { name: "Message input" })).toHaveText(
    unsentDraft,
  );
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();

  // A new ClientSession reduces the same saved terminal events after reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: title, exact: true }).click();
  await expect(page.locator(".aui-working-answer")).toHaveCount(1);
  await expect(page.locator(".aui-working-answer")).toHaveText(
    callbackFinalText,
  );
  await expect(page.locator(".aui-working-step")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Stop generating" }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Message input" })
    .fill("An unsent follow-up is ready");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
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
