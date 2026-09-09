import { expect, test, type Page } from "@playwright/test";
import type { EventPage } from "../../packages/client/src";

/**
 * H1: a Locked (denied) wallet can still chat. The client never blocks the
 * turn on routing; the backend commit gate reports `signing_denied` only when
 * a transaction is actually prepared.
 *
 * Preconditions: the E2E stub user (E2E_STUB_CANONICAL_USER_ID) has the E2E
 * address bound with signing mode `denied` (seeded by the T2 harness).
 */
const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";
const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
const walletAddress =
  process.env.AOMI_E2E_WALLET_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test.describe.configure({ mode: "serial", timeout: 10 * 60_000 });

test("a locked wallet still chats and the backend gate reports signing_denied", async ({
  page,
}) => {
  test.skip(!walletToken, "AOMI_E2E_WALLET_TOKEN is required");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let starts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/v1\/agent\/chat$/.test(new URL(request.url()).pathname)
    ) {
      starts += 1;
    }
  });
  let deniedAtCommit = false;
  page.on("response", async (response) => {
    if (!/\/v1\/agent\/chat(?:\/|$)/.test(new URL(response.url()).pathname))
      return;
    if (response.status() !== 200) return;
    try {
      const body = (await response.json()) as EventPage;
      deniedAtCommit ||= (body.events ?? []).some(
        (event) =>
          event.type === "tool_complete" &&
          event.tool_name === "evm_commit_txs" &&
          JSON.stringify(event.result).includes("[err.type=signing_denied]"),
      );
    } catch {
      // Non-event responses cannot prove the commit gate ran.
    }
  });

  await seedWallet(page);
  // A plain message must go out regardless of the signing policy.
  await send(page, "ROUTING LOCKED: say hello in one short sentence.");
  await expect.poll(() => starts, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);

  // A transaction request reaches the backend and is refused there.
  await send(
    page,
    `ROUTING LOCKED: send 0 ETH on chain 31337 to ${recipient}. ` +
      "Prepare and simulate it, then call commit_txs in this same turn. " +
      "Do not ask me for another chat message.",
  );
  await expect.poll(() => deniedAtCommit, { timeout: 180_000 }).toBe(true);
  await expect(
    page
      .locator('[data-role="assistant"]')
      .filter({ hasText: /signing_denied|locked|denied/i })
      .last(),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
  await expect(
    page.getByRole("textbox", { name: "Message input" }),
  ).toBeEnabled();
});

async function seedWallet(page: Page): Promise<void> {
  const seed = new URL("/api/bff/e2e/wallet", portalOrigin);
  seed.searchParams.set("token", walletToken!);
  seed.searchParams.set("address", walletAddress);
  seed.searchParams.set("chainId", "31337");
  seed.searchParams.set("redirect", "/");
  await page.goto(seed.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");
}

async function send(page: Page, message: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Message input" });
  const submit = page.getByRole("button", { name: "Send message" });
  await input.fill(message);
  await expect(input).toHaveValue(message);
  await expect(submit).toBeEnabled();
  await submit.click();
}
