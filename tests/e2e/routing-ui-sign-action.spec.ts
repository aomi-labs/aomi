import { expect, test, type Page } from "@playwright/test";

/**
 * E-Hosted-AA-Manual-UI: an AA operation arrives as a `sign` Action (owner
 * authorization) and the backend submits. The Action card shows the
 * authorizing account, "Submitted by hosted", and the funding facts; the
 * wallet's `sendTransaction` path is never used.
 *
 * Preconditions: an application with an `application_execution_policies`
 * row (erc4337) selected via AOMI_E2E_AA_APP (the app name to lock the chat
 * to), plus the E2E wallet. Locally this certifies the gate and the card only;
 * execution against a bundler is the T7 staging gate.
 */
const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";
const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
const aaApp = process.env.AOMI_E2E_AA_APP;
const walletAddress =
  process.env.AOMI_E2E_WALLET_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test.describe.configure({ mode: "serial", timeout: 10 * 60_000 });

test("an AA operation renders as a hosted sign Action and never hits the wallet execute route", async ({
  page,
}) => {
  test.skip(!walletToken, "AOMI_E2E_WALLET_TOKEN is required");
  test.skip(
    !aaApp,
    "AOMI_E2E_AA_APP (an app with an erc4337 execution policy) is required",
  );

  let executeCalled = false;
  await page.route("**/api/bff/e2e/execute", async (route) => {
    executeCalled = true;
    await route.continue();
  });
  const signActions: Array<{
    request: {
      type: string;
      executionKind?: string;
      operationId?: string;
      broadcaster?: string;
    };
  }> = [];
  page.on("response", async (response) => {
    if (!/\/v1\/agent\/chat\//.test(new URL(response.url()).pathname)) return;
    if (response.status() !== 200) return;
    try {
      const body = (await response.json()) as {
        events?: Array<{ type: string; state?: string; request?: unknown }>;
      };
      for (const event of body.events ?? []) {
        if (event.type === "action" && event.state === "pending") {
          signActions.push(event as never);
        }
      }
    } catch {
      // ignore
    }
  });

  await seedWallet(page, `/?app=${encodeURIComponent(aaApp!)}`);
  await send(
    page,
    `ROUTING AA: send 0 ETH on chain 31337 to ${recipient}. ` +
      "Prepare it and call commit_txs in this same turn so the runtime emits an Action. " +
      "Do not ask me for another chat message.",
  );
  await expect(page.getByTestId("transaction-review")).toBeVisible({
    timeout: 300_000,
  });
  await expect(page.getByText("Authorizing account")).toBeVisible();
  await expect(page.getByText("Submitted by")).toBeVisible();
  await expect(page.getByText(/hosted/)).toBeVisible();
  await expect(page.getByText("Network funding")).toBeVisible();

  await expect
    .poll(() => signActions.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const request = signActions[0].request;
  expect(request.type).toBe("sign");
  expect(request.executionKind).toBe("erc4337");
  expect(request.operationId).toBeTruthy();
  expect(request.broadcaster).toBe("hosted");
  expect(executeCalled).toBe(false);
});

async function seedWallet(page: Page, redirect = "/"): Promise<void> {
  const seed = new URL("/api/bff/e2e/wallet", portalOrigin);
  seed.searchParams.set("token", walletToken!);
  seed.searchParams.set("address", walletAddress);
  seed.searchParams.set("chainId", "31337");
  seed.searchParams.set("redirect", redirect);
  await page.goto(seed.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");
}

async function send(page: Page, message: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Message input" });
  const submit = page.getByRole("button", { name: "Send message" });
  await expect(input).toHaveAttribute("contenteditable", "true");
  await input.pressSequentially(message);
  await expect(input).toHaveText(message);
  await expect(submit).toBeEnabled();
  await submit.click();
}
