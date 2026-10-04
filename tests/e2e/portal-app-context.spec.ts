import { expect, test, type Page } from "@playwright/test";

// Real Portal components and navigation, controlled browser-level API data.
// This suite never authenticates with a provider or signs/broadcasts funds.
const appQuery = "?app=hoodit&application_id=2937810";
const portalOrigin =
  process.env.GUEST_BROWSER_BASE_URL ??
  process.env.LOCAL_PORTAL_URL ??
  "http://localhost:3000";
const apps = [
  { name: "default", metadata: { source: "builtin" } },
  {
    name: "hoodit",
    application_id: 2937810,
    is_installed: true,
    metadata: { source: "builtin" },
  },
  {
    name: "research-agent",
    application_id: 42,
    is_installed: true,
    label: "Research Agent",
    is_public: false,
  },
  { name: "not-enabled", application_id: 43, label: "Not Enabled" },
];

async function installFixtures(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aomi-cookie-consent", "declined");
  });
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  let historyRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === portalOrigin ? route.continue() : route.abort();
  });
  await page.route(/\/(?:api|v1)\//, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== portalOrigin) return route.abort();
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/v1/account")
      return json({
        user: { id: "app-context-fixture", displayName: "UI test account" },
        linkedAccounts: [],
        wallets: [],
        session: {
          carrier: "better_auth",
          betterAuthUserId: "app-context-fixture",
        },
      });
    if (path === "/api/auth/get-session")
      return json({ user: { id: "app-context-fixture", isAnonymous: false } });
    if (path === "/api/account")
      return json({
        user: {
          user_id: "app-context-fixture",
          apps: ["default", "hoodit", "research-agent"],
          application_ids: [2937810, 42],
        },
      });
    if (path === "/v1/account/credits")
      return json({
        period_utc_month: "2026-10",
        included_limit: 10_000_000,
        included_used: 1_250_000,
        included_remaining: 8_750_000,
        balance: 0,
        outstanding_debt: 0,
        records: [],
        next_before_id: null,
      });
    if (path === "/v1/account/bearer")
      return json({ bearer: "browser-fixture-only" });
    if (path === "/api/thread/models") return json(["fixture-model"]);
    if (path === "/api/thread/apps") return json(apps);
    if (path === "/api/resource/skills") return json({ skills: [] });
    if (path === "/api/account/model-keys") return json({ keys: [] });
    if (/^\/api\/account\/apps\/\d+\/secrets$/.test(path)) {
      return json({
        application_id: Number(path.split("/")[4]),
        app: "hoodit",
        slots: [],
        ready: true,
        missing_required: [],
      });
    }
    if (path === "/v1/agent/sessions") {
      historyRequests++;
      return json({
        sessions: [
          {
            id: "app-context-existing",
            title: "Existing fixture chat",
            updatedAt: Date.now(),
            archived: false,
          },
        ],
        nextCursor: null,
      });
    }
    if (path === "/v1/agent/chat/app-context-existing")
      return json({
        session_id: "app-context-existing",
        cursor: "2",
        has_more: false,
        events: url.searchParams.has("cursor")
          ? []
          : [
              {
                type: "message",
                event_id: "existing-1",
                sequence: 1,
                turn_id: "fixture-turn",
                occurred_at: 1,
                sender: "user",
                content: "Fixture question",
              },
              {
                type: "message",
                event_id: "existing-2",
                sequence: 2,
                turn_id: "fixture-turn",
                occurred_at: 2,
                sender: "agent",
                content: "Existing fixture answer.",
              },
            ],
      });
    if (path.endsWith("/stream"))
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
    if (path.includes("transaction-safety"))
      return json({ level: "balanced", version: 1, source: "account_default" });
    unexpected.push(`${request.method()} ${path}`);
    return json({ error: "Unhandled app-context fixture route" }, 599);
  });
  return { unexpected, pageErrors, historyRequests: () => historyRequests };
}

test.describe("narrow mobile with unavailable catalog", () => {
  test.use({
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true,
  });
  for (const app of ["hoodit", "private-agent"]) {
    test(`${app} stays visible and locked without catalog data`, async ({
      page,
    }, testInfo) => {
      await installFixtures(page);
      await page.route("**/api/thread/apps*", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture catalog unavailable" }),
        }),
      );
      await page.goto(`/?app=${app}&application_id=2937810&lock_app=1`);
      const indicator = await visibleIndicator(page);
      await expect(indicator).toHaveAttribute(
        "aria-label",
        app === "hoodit"
          ? "Selected app: Hoodit"
          : "Selected app: Private Agent",
      );
      await indicator.scrollIntoViewIfNeeded();
      const name = indicator.locator("span").first();
      await expect(name).toBeVisible();
      if (app === "hoodit") {
        expect(
          await name.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
      const appBox = await indicator.boundingBox();
      const sendBox = await page
        .getByRole("button", { name: "Send message" })
        .boundingBox();
      expect(appBox!.x + appBox!.width).toBeLessThanOrEqual(sendBox!.x);
      expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(320);
      await expect(indicator.locator("svg").first()).toHaveClass(
        app === "hoodit" ? /^(?!.*lucide-app-window)/ : /lucide-app-window/,
      );
      await page.screenshot({
        path: testInfo.outputPath(
          `narrow-mobile-${app}-catalog-unavailable.png`,
        ),
        fullPage: true,
      });
    });
  }
});

async function visibleIndicator(page: Page) {
  const indicator = page
    .getByTestId("composer-selected-app")
    .filter({ visible: true });
  await expect(indicator).toBeVisible();
  return indicator;
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(viewport.name, () => {
    test.use({
      viewport,
      isMobile: viewport.name === "mobile",
      hasTouch: viewport.name === "mobile",
    });
    test.setTimeout(60_000);

    test("locked URL app stays visible through refresh, existing/new chat and sidebar navigation", async ({
      page,
    }, testInfo) => {
      const fixture = await installFixtures(page);
      await page.goto(`/${appQuery}&lock_app=1`);
      await expect(page.getByTestId("portal-shell")).toBeVisible();
      await expect
        .poll(async () => (await visibleIndicator(page)).textContent())
        .toContain("Hoodit");
      let indicator = await visibleIndicator(page);
      await expect(indicator).toHaveAttribute(
        "aria-label",
        "Selected app: Hoodit",
      );
      await expect(indicator).toHaveText("Hoodit");
      await expect(indicator.locator("svg").first()).not.toHaveClass(
        /lucide-app-window/,
      );
      expect(await indicator.evaluate((element) => element.tagName)).toBe(
        "SPAN",
      );
      await expect(
        page.getByRole("textbox", { name: "Message input" }),
      ).toBeVisible();
      await expect(indicator.locator("button")).toHaveCount(0);
      await expect(page.locator(".aui-composer-action-scroll")).toContainText(
        "Hoodit",
      );
      await expect(
        page.locator("header").getByTestId("composer-selected-app"),
      ).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-locked-new-chat.png`),
        fullPage: true,
      });
      const historyBeforeReload = fixture.historyRequests();
      await page.reload();
      await expect
        .poll(fixture.historyRequests)
        .toBeGreaterThan(historyBeforeReload);
      await expect
        .poll(async () => (await visibleIndicator(page)).textContent())
        .toContain("Hoodit");
      if (viewport.name === "mobile")
        await page
          .locator("header")
          .getByRole("button", { name: "Toggle Sidebar" })
          .click();
      await page.getByText("Existing fixture chat", { exact: true }).click();
      if (viewport.name === "mobile") await page.keyboard.press("Escape");
      await expect(
        page.getByText("Existing fixture answer.", { exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => new URL(page.url()).searchParams.has("thread"))
        .toBe(true);
      const savedUrl = page.url();
      indicator = await visibleIndicator(page);
      await expect(indicator).toHaveText("Hoodit");
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-locked-existing-chat.png`),
        fullPage: true,
      });
      if (viewport.name === "mobile")
        await page
          .locator("header")
          .getByRole("button", { name: "Toggle Sidebar" })
          .click();
      await page.getByRole("button", { name: "New chat", exact: true }).click();
      if (viewport.name === "mobile") await page.keyboard.press("Escape");
      await expect
        .poll(async () => (await visibleIndicator(page)).textContent())
        .toContain("Hoodit");
      await expect
        .poll(() => new URL(page.url()).searchParams.has("thread"))
        .toBe(false);
      await expect(
        page.getByText("Existing fixture answer.", { exact: true }),
      ).toBeHidden();
      await page.goBack();
      await expect(page).toHaveURL(savedUrl);
      await expect(
        page.getByText("Existing fixture answer.", { exact: true }),
      ).toBeVisible();
      await page.goForward();
      await expect
        .poll(() => new URL(page.url()).searchParams.has("thread"))
        .toBe(false);
      await expect(
        page.getByText("Existing fixture answer.", { exact: true }),
      ).toBeHidden();
      expect(new URL(page.url()).searchParams.get("app")).toBe(
        new URL(savedUrl).searchParams.get("app"),
      );
      if (viewport.name === "desktop") {
        await page
          .locator("header")
          .getByRole("button", { name: "Toggle Sidebar" })
          .click();
        await expect(
          page
            .locator(".aui-composer-action-scroll")
            .getByTestId("composer-selected-app"),
        ).toBeVisible();
      }
      expect(fixture.pageErrors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
    });

    test("unlocked URL app is informational and preserves context through browser navigation", async ({
      page,
    }, testInfo) => {
      const fixture = await installFixtures(page);
      await page.goto(`/${appQuery}&funding=user_byok`);
      await expect(await visibleIndicator(page)).toHaveText("Hoodit");
      await expect(
        page.getByRole("button", { name: /Select app:/ }),
      ).toHaveCount(0);
      await page.goto(
        "/?app=research-agent&application_id=42&funding=user_byok",
      );
      const indicator = await visibleIndicator(page);
      await indicator.scrollIntoViewIfNeeded();
      await expect(indicator).toHaveText("Research Agent");
      await expect(indicator.locator("svg").first()).toHaveClass(
        /lucide-app-window/,
      );
      await page.screenshot({
        path: testInfo.outputPath(`${viewport.name}-generic-app.png`),
        fullPage: true,
      });
      await page.reload();
      await expect(await visibleIndicator(page)).toHaveText("Research Agent");
      expect(new URL(page.url()).searchParams.get("funding")).toBe("user_byok");
      await page.goto("/");
      await expect(page.getByTestId("composer-selected-app")).toHaveCount(0);
      await page.goBack();
      await expect(await visibleIndicator(page)).toHaveText("Research Agent");
      expect(fixture.pageErrors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
    });
  });
}
