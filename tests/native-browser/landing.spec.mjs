import { randomUUID } from "node:crypto";
import { test, expect, navigate, localImageLoads } from "./fixture.mjs";
import { nativeBrowserCases } from "./requirements.mjs";

const cases = nativeBrowserCases.landing;

test(cases[0], async ({ page }) => {
  await navigate(page, "/");
  const resources = page
    .locator(".landing-nav-trigger")
    .filter({ hasText: /^Resources$/ });
  await expect(resources).toHaveAttribute("aria-expanded", "false");
  await resources.click();
  await expect(resources).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("menu", { name: "Resources", exact: true }),
  ).toBeVisible();
  await localImageLoads(page, 'img[src="./logos/ethereum.png"]');
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await video.scrollIntoViewIfNeeded();
  await expect(video).toBeVisible();
  await expect
    .poll(() =>
      video.evaluate((element) => ({
        ready: element.readyState >= HTMLMediaElement.HAVE_METADATA,
        width: element.videoWidth > 0,
        duration: Number.isFinite(element.duration) && element.duration > 0,
        error: element.error?.message ?? null,
      })),
    )
    .toEqual({ ready: true, width: true, duration: true, error: null });
  expect(
    await video.evaluate((element) => new URL(element.currentSrc).pathname),
  ).toBe("/assets/landing/home/media/three-gates.mp4");
});

test(cases[1], async ({ page, browserEvidence }) => {
  await navigate(page, "/blog");
  await expect(
    page.getByRole("heading", { name: "Blog", exact: true }),
  ).toBeVisible();
  // A real state change establishes hydration before the client-navigation proof.
  const resources = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("button", { name: "Resources", exact: true });
  await page.waitForFunction(
    () => globalThis.__TSR_ROUTER__?.state.status === "idle",
  );
  await resources.click();
  await expect(resources).toHaveAttribute("aria-expanded", "true");
  await resources.click();
  await expect(resources).toHaveAttribute("aria-expanded", "false");
  await localImageLoads(page, 'main img[src^="/assets/covers/"]');
  const marker = randomUUID();
  await page.evaluate((value) => {
    window.__aomiNativeBrowserDocument = value;
  }, marker);
  browserEvidence.documents.length = 0;
  const article = page.locator(
    'main a[href="/research/introducing-the-aomi-task-api"]',
  );
  await expect(article).toHaveCount(1);
  await article.click();
  await expect(page).toHaveURL(/\/research\/introducing-the-aomi-task-api$/);
  await expect(page.locator("main h1")).toContainText(
    "Introducing the Aomi Task API",
  );
  await expect(page.locator("main article")).toContainText("USDC");
  await localImageLoads(
    page,
    'main img[src^="/research/introducing-the-aomi-task-api/"]',
  );
  expect(await page.evaluate(() => window.__aomiNativeBrowserDocument)).toBe(
    marker,
  );
  expect(
    browserEvidence.documents,
    "Article navigation must use the hydrated router",
  ).toEqual([]);
  await page.goBack();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(
    page.getByRole("heading", { name: "Blog", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.__aomiNativeBrowserDocument)).toBe(
    marker,
  );
  expect(
    browserEvidence.documents,
    "History navigation must preserve the document",
  ).toEqual([]);
});

test(cases[2], async ({ page }) => {
  const proxyCalls = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/proxy")
      proxyCalls.push(request.url());
  });
  await navigate(page, "/examples/polymarket");
  await expect(
    page.getByRole("heading", { name: "Polymarket", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText("three public API surfaces");
  await page.getByRole("button", { name: /Get Market by Slug/ }).click();
  const slug = page.getByPlaceholder("e.g. will-bitcoin-reach-100k-by-2025");
  await expect(slug).toBeVisible();
  await slug.fill("browser-fixture");
  await expect(
    page.locator("code").filter({ hasText: "/markets?slug=browser-fixture" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toBeEnabled();
  expect(
    proxyCalls,
    "Editing the example must not send an API operation",
  ).toEqual([]);
});

test(cases[3], async ({ page }) => {
  await navigate(page, "/playground/configurator");
  // The immutable MDX exposes its title as metadata, with no visible DocsTitle.
  await expect(page).toHaveTitle("Configurator");
  const message = page.getByRole("textbox", {
    name: "Message input",
    exact: true,
  });
  await expect(message).toBeVisible();
  const messageBounds = await message.boundingBox();
  expect(messageBounds.width).toBeGreaterThan(300);
  const shown = page.getByRole("button", { name: "Shown", exact: true });
  await expect(shown).toHaveAttribute("aria-pressed", "true");
  await shown.click();
  await expect(shown).toHaveAttribute("aria-pressed", "false");
  const code = page.locator("pre").filter({ hasText: "showSidebar={false}" });
  await expect(code).toBeVisible();
  await expect(code).toContainText("showSidebarTrigger={false}");
  await expect(
    page.getByRole("textbox", { name: "Message input", exact: true }),
  ).toBeVisible();
  await shown.click();
  await expect(shown).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator("pre").filter({ hasText: "AomiFrame.Root" }),
  ).not.toContainText("showSidebar={false}");
});
