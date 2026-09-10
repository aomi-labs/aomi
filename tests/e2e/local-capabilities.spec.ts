import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 900, height: 480 },
  { width: 390, height: 640 },
]) {
  test(`capability picker remains reachable at ${viewport.width}×${viewport.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const input = page.getByRole("textbox", { name: "Message input" });
    await expect(input).toBeVisible({ timeout: 30_000 });
    await expect(input).toHaveAttribute("contenteditable", "true");
    await page
      .getByRole("button", { name: "Add app, skill, or chain" })
      .click();
    const picker = page.getByRole("listbox", {
      name: "Apps, skills, and chains",
    });
    await expect(picker).toBeVisible();
    await expect
      .poll(async () => {
        const panel = await picker.locator("..").boundingBox();
        const content = await page
          .locator(".aui-thread-viewport")
          .boundingBox();
        return (
          !!panel &&
          !!content &&
          panel.y >= content.y &&
          panel.y + panel.height <= content.y + content.height &&
          panel.x >= 0 &&
          panel.x + panel.width <= viewport.width
        );
      })
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("picker.png") });
    await input.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeVisible();
  });
}

test("composer keyboard editing sends only the retained chain hint", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const events: Array<{ type?: string; state?: string }> = [];
  page.on("response", async (response) => {
    if (
      response.status() !== 200 ||
      !new URL(response.url()).pathname.startsWith("/v1/agent/chat")
    )
      return;
    const body = await response.json().catch(() => null);
    events.push(...(body?.events ?? []));
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const request = new Request(
        input instanceof Request ? input.clone() : input,
        init,
      );
      const url = new URL(request.url);
      if (
        url.origin === window.location.origin &&
        url.pathname === "/v1/agent/chat" &&
        request.method === "POST"
      ) {
        (
          window as Window & { aomiComposerRequestBody?: string }
        ).aomiComposerRequestBody = await request.clone().text();
      }
      return originalFetch.call(window, input, init);
    };
  });
  const token = process.env.AOMI_E2E_WALLET_TOKEN;
  const address = process.env.AOMI_E2E_WALLET_ADDRESS;
  expect(token, "AOMI_E2E_WALLET_TOKEN is required").toBeTruthy();
  expect(
    address,
    "E2E wallet must match the configured executor signer",
  ).toBeTruthy();
  const seed = new URLSearchParams({
    token: token!,
    address: address!,
    chainId: "31337",
    redirect: "/",
  });
  await page.goto(`/api/bff/e2e/wallet?${seed}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  const input = page.getByRole("textbox", { name: "Message input" });
  await expect(input).toHaveAttribute("contenteditable", "true");
  const picker = page.getByRole("listbox", {
    name: "Apps, skills, and chains",
  });
  const base = input.locator('[data-capability-key="chain:eip155:8453"]');
  await input.pressSequentially(
    "Reply exactly CAPABILITY_READY without calling tools. @8453",
  );
  const baseOption = picker.getByRole("option").filter({
    has: page.getByText("Base", { exact: true }),
  });
  const baseSepoliaOption = picker.getByRole("option").filter({
    has: page.getByText("Base Sepolia", { exact: true }),
  });
  await expect(baseOption).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowDown");
  await expect(baseSepoliaOption).toHaveAttribute("aria-selected", "true");
  await input.press("ArrowUp");
  await expect(baseOption).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(base).toBeVisible();
  await expect(input).toBeFocused();
  await input.press("Backspace");
  await expect(base).toHaveCount(0);
  await expect(input).toContainText(
    "Reply exactly CAPABILITY_READY without calling tools.",
  );
  await input.pressSequentially("@8453");
  await expect(baseOption).toHaveAttribute("aria-selected", "true");
  await input.press("Tab");
  await expect(base).toBeVisible();
  await expect(input).toBeFocused();

  const started = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/agent/chat" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const response = await started;
  expect(response.status()).toBe(200);
  const requestBody =
    response.request().postData() ??
    response.request().postDataBuffer()?.toString("utf8") ??
    (await page.evaluate(
      () =>
        (window as Window & { aomiComposerRequestBody?: string })
          .aomiComposerRequestBody,
    ));
  expect(
    requestBody,
    "Actual submitted request body must be observed",
  ).toBeTruthy();
  const intent = JSON.parse(requestBody!) as { message: string; mode?: string };
  expect(intent.mode ?? "auto").toBe("auto");
  expect(intent.message).toContain("CAPABILITY_READY");
  expect(intent.message).toContain(
    "Preferred execution chain ids: eip155:8453.",
  );
  expect(intent.message.match(/<AOMI_UI_CAPABILITY_HINTS>/g)).toHaveLength(1);
  expect(intent.message).not.toContain("eip155:84532");
  expect(intent.message).not.toContain("Preferred app ids:");
  expect(intent.message).not.toContain("Preferred skill ids:");
  await expect
    .poll(
      () =>
        events.filter((event) => event.type === "turn_state_changed").at(-1)
          ?.state,
      { timeout: 150_000 },
    )
    .toBe("complete");
  await expect(
    page.getByText("CAPABILITY_READY", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/<AOMI_UI_CAPABILITY_HINTS>/)).toHaveCount(0);
  await expect(base).toHaveCount(0);
});

test("live Library search, details, and Try insert a skill into the composer", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Open capability library" }).click();
  const library = page.getByRole("dialog", { name: "Library", exact: true });
  await expect(library).toBeVisible();
  await library
    .getByRole("navigation", { name: "Library sections" })
    .getByRole("button", { name: /^Skills/ })
    .click();
  const firstSkill = library
    .getByRole("button", { name: /^Open .+ details$/ })
    .first();
  await expect(firstSkill).toBeVisible({ timeout: 30_000 });
  const label = await firstSkill.getAttribute("aria-label");
  const skillName = label?.slice("Open ".length, -" details".length);
  expect(skillName).toBeTruthy();
  const search = library.getByRole("textbox", { name: "Search library" });
  await search.fill("e2e-no-capability-matches-this-query");
  await expect(
    library.getByText("No capabilities found", { exact: true }),
  ).toBeVisible();
  await library.getByRole("button", { name: "Clear search" }).click();
  await search.fill(skillName!);
  await library
    .getByRole("button", { name: `Open ${skillName} details`, exact: true })
    .click();
  const detail = library.getByRole("complementary", {
    name: `${skillName} details`,
    exact: true,
  });
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: skillName, exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: "How it works", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await detail.getByRole("button", { name: "Try", exact: true }).click();
  await expect(library).toHaveCount(0);
  const input = page.getByRole("textbox", { name: "Message input" });
  await expect(input).toHaveAttribute("contenteditable", "true");
  await expect(input.locator('[data-capability-key^="skill:"]')).toHaveCount(1);
  await expect(
    input.locator('[data-capability-key^="skill:"]'),
  ).toHaveAttribute("aria-label", `skill ${skillName}`);
  await expect(input).toBeFocused();
  await input.pressSequentially(" explain this capability");
  await expect(input).toContainText("explain this capability");
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeEnabled();
});
