import { expect, test } from "@playwright/test";

const userMessage = "guest regression message";
const agentMessage = "Deterministic guest answer.";
const guestCookie = "aomi_guest_browser_fixture";

test("real Portal auth route admits its own origin and rejects an unregistered browser origin", async ({
  request,
}) => {
  const base = process.env.GUEST_BROWSER_BASE_URL;
  expect(base).toBeTruthy();
  const tokenUrl = `${base}/api/auth/oauth2/token`;
  const form = { grant_type: "client_credentials" };
  const own = await request.post(tokenUrl, {
    headers: { origin: base! },
    form,
  });
  expect(own.status()).toBeLessThan(500);
  expect(own.status()).not.toBe(403);

  const foreign = await request.post(tokenUrl, {
    headers: { origin: "https://unregistered.example" },
    form,
  });
  expect(foreign.status()).toBe(403);
  expect(await foreign.json()).toEqual({ error: "origin_not_allowed" });
});

type Event = {
  type: string;
  event_id: string;
  sequence: number;
  turn_id: string;
  occurred_at: number;
  sender?: string;
  content?: string;
  state?: string;
};

test("guest response settles once and the same conversation survives refresh", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const threads = new Map<string, { owner: string; events: Event[] }>();
  const unexpectedRequests: string[] = [];
  let releaseSession!: () => void;
  const sessionHold = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  let holdSession = true;
  let heldSessions = 0;
  let starts = 0;
  let lists = 0;
  await page.route("**/*", (route) => {
    if (
      new URL(route.request().url()).origin ===
      process.env.GUEST_BROWSER_BASE_URL
    ) {
      return route.continue();
    }
    return route.abort();
  });
  await page.route(/\/(?:api|v1)\//, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (url.origin !== process.env.GUEST_BROWSER_BASE_URL) return route.abort();
    const guestId = request
      .headers()
      .cookie?.match(new RegExp(`${guestCookie}=([^;]+)`))?.[1];
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/api/auth/get-session") {
      if (holdSession) {
        heldSessions++;
        await sessionHold;
      }
      return json(
        guestId ? { user: { id: guestId, isAnonymous: true } } : null,
      );
    }
    if (path === "/api/auth/sign-in/anonymous" && request.method() === "POST") {
      await context.addCookies([
        {
          name: guestCookie,
          value: "guest-1",
          url: url.origin,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      return json({ user: { id: "guest-1", isAnonymous: true } });
    }
    if (path === "/api/account" || path === "/v1/account")
      return json({ error: "unauthorized" }, 401);
    if (path === "/v1/agent/sessions" && request.method() === "GET") {
      lists++;
      if (!guestId) return json({ error: { code: "invalid_token" } }, 401);
      return json({
        sessions: [...threads.entries()]
          .filter(([, thread]) => thread.owner === guestId)
          .map(([id]) => ({
            id,
            title: userMessage,
            updatedAt: Date.now(),
            archived: false,
          })),
        nextCursor: null,
      });
    }
    if (path === "/v1/agent/chat" && request.method() === "POST") {
      if (!guestId) return json({ error: { code: "invalid_token" } }, 401);
      starts++;
      const intent = request.postDataJSON() as {
        sessionId: string;
        message: string;
      };
      expect(intent.message).toBe(userMessage);
      const turnId = "turn-1";
      const base = { turn_id: turnId, occurred_at: Date.now() / 1000 };
      const events: Event[] = [
        {
          ...base,
          type: "message",
          event_id: "user-1",
          sequence: 1,
          sender: "user",
          content: userMessage,
        },
        {
          ...base,
          type: "message",
          event_id: "agent-1",
          sequence: 2,
          sender: "agent",
          content: agentMessage,
        },
        {
          ...base,
          type: "turn_state_changed",
          event_id: "done-1",
          sequence: 3,
          state: "complete",
        },
      ];
      threads.set(intent.sessionId, { owner: guestId, events });
      return json({
        session_id: intent.sessionId,
        cursor: "3",
        events,
        has_more: false,
      });
    }
    const poll = path.match(/^\/v1\/agent\/chat\/([^/]+)$/);
    if (poll && request.method() === "GET") {
      if (!guestId) return json({ error: { code: "invalid_token" } }, 401);
      const thread = threads.get(poll[1]);
      if (!thread || thread.owner !== guestId)
        return json({ error: { code: "session_not_found" } }, 404);
      return json({
        session_id: poll[1],
        cursor: "3",
        events: url.searchParams.has("cursor") ? [] : thread.events,
        has_more: false,
      });
    }
    if (path.startsWith("/v1/agent/chat/") && path.endsWith("/stream")) {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
    }
    if (
      path.startsWith("/v1/agent/sessions/") &&
      request.method() === "PATCH"
    ) {
      const id = path.split("/").at(-1)!;
      return json({
        id,
        title: userMessage,
        updatedAt: Date.now(),
        archived: false,
      });
    }
    if (path === "/api/thread/models" || path === "/api/control/models")
      return json(["fixture-model"]);
    if (path === "/api/thread/apps" || path === "/api/control/apps")
      return json([{ name: "default", is_public: true }]);
    if (path === "/api/resource/skills") return json({ skills: [] });
    if (path === "/api/account/model-keys")
      return json({ error: "unauthorized" }, 401);
    unexpectedRequests.push(`${request.method()} ${path}`);
    return json({ error: "Unhandled browser fixture route" }, 599);
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const portalShell = page.getByTestId("portal-shell");
  await expect.poll(() => heldSessions).toBeGreaterThan(0);
  await expect(portalShell).toBeVisible();
  await expect(portalShell).toHaveAttribute("inert", "");
  expect(starts).toBe(0);
  expect(lists).toBe(0);
  holdSession = false;
  releaseSession();
  await expect(portalShell).not.toHaveAttribute("inert");
  const input = page.getByRole("textbox", { name: "Message input" });
  await expect(input).toHaveAttribute("contenteditable", "true");
  await input.pressSequentially(userMessage);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page
      .locator(".aui-assistant-message-root")
      .filter({ hasText: agentMessage }),
  ).toHaveCount(1);
  await expect(
    page.locator(".aui-user-message-root").filter({ hasText: userMessage }),
  ).toHaveCount(1);
  expect(starts).toBe(1);
  expect(threads.size).toBe(1);
  const threadId = [...threads.keys()][0];

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible();
  await expect.poll(() => lists).toBeGreaterThan(0);
  await expect(page.getByText(userMessage, { exact: true })).toBeVisible();
  const row = page.locator(`[data-thread-id="${threadId}"]`);
  await expect(row).toHaveCount(1);
  await row.locator(".aui-thread-list-item-trigger").click();
  await expect(
    page
      .locator(".aui-assistant-message-root")
      .filter({ hasText: agentMessage }),
  ).toHaveCount(1);
  await expect(
    page.locator(".aui-user-message-root").filter({ hasText: userMessage }),
  ).toHaveCount(1);
  expect(starts).toBe(1);
  expect([...threads.keys()]).toEqual([threadId]);
  const screenshotPath =
    "output/playwright/guest-regression/restored-guest-conversation.png";
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await test.info().attach("restored-guest-conversation", {
    path: screenshotPath,
    contentType: "image/png",
  });

  await context.addCookies([
    {
      name: guestCookie,
      value: "guest-2",
      url: process.env.GUEST_BROWSER_BASE_URL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(page.getByText(agentMessage, { exact: true })).toHaveCount(0);

  await context.addCookies([
    {
      name: guestCookie,
      value: "guest-1",
      url: process.env.GUEST_BROWSER_BASE_URL!,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(row).toHaveCount(1);
  expect(starts).toBe(1);
  expect(unexpectedRequests).toEqual([]);
});
