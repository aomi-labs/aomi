import { test, expect, navigate } from "./fixture.mjs";
import { nativeBrowserCases } from "./requirements.mjs";

test(nativeBrowserCases.telegram[0], async ({ page, baseURL }) => {
  expect(new URL(baseURL).hostname).toBe("telegram-artifact.localhost");
  expect(new URL(baseURL).protocol).toBe("https:");
  const launches = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/telegram/launch"
    )
      launches.push(request.url());
  });
  await navigate(page, "/");
  expect(
    await page.evaluate(() => ({
      hostname: location.hostname,
      protocol: location.protocol,
      secure: window.isSecureContext,
      randomUUID: typeof window.crypto.randomUUID,
    })),
  ).toEqual({
    hostname: "telegram-artifact.localhost",
    protocol: "https:",
    secure: true,
    randomUUID: "function",
  });
  await expect(page.getByText("Aomi Wallet", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Open this page from Telegram.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This deployment is missing its wallet provider configuration.",
      { exact: false },
    ),
  ).toHaveCount(0);
  const details = page.getByRole("button", { name: "Details", exact: true });
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await details.click();
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText("open_from_telegram", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.Telegram?.WebApp?.initData ?? ""),
  ).toBe("");
  await expect(
    page.getByRole("button", { name: "Create new wallet", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Use existing wallet", exact: true }),
  ).toHaveCount(0);
  expect(
    launches,
    "An unsigned browser must not exchange a Telegram identity",
  ).toEqual([]);
});
