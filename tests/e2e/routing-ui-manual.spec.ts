import { expect, test, type Page } from "@playwright/test";

/**
 * E-Wallet-noAA-Manual-UI: a Manual wallet never pins a submitter. The turn
 * goes out with `userState.evm` lacking `broadcaster`, and the backend
 * prepares an `execute_evm` Action for the wallet to sign and submit.
 *
 * Preconditions: local portal with the E2E wallet enabled (see plan T4) and
 * the seeded user in Manual mode for the E2E address.
 */
const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";
const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
const walletAddress =
  process.env.AOMI_E2E_WALLET_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

test.describe.configure({ mode: "serial", timeout: 10 * 60_000 });

test("Manual wallet sends no broadcaster and receives an execute_evm Action", async ({
  page,
}) => {
  test.skip(!walletToken, "AOMI_E2E_WALLET_TOKEN is required");

  const starts: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/v1\/agent\/chat$/.test(new URL(request.url()).pathname)
    ) {
      try {
        starts.push(JSON.parse(request.postData() ?? "{}"));
      } catch {
        // non-JSON bodies are not turn starts
      }
    }
  });
  const actions: Array<{ request?: { type?: string } }> = [];
  page.on("response", async (response) => {
    if (!/\/v1\/agent\/chat\//.test(new URL(response.url()).pathname)) return;
    if (response.status() !== 200) return;
    try {
      const body = (await response.json()) as {
        events?: Array<{ type: string; state?: string; request?: unknown }>;
      };
      for (const event of body.events ?? []) {
        if (event.type === "action" && event.state === "pending") {
          actions.push(event as never);
        }
      }
    } catch {
      // ignore non-event responses
    }
  });

  await seedWallet(page);
  await send(
    page,
    `ROUTING MANUAL: send 0 ETH on chain 31337 to ${recipient}. ` +
      "Prepare and simulate it, then call commit_txs in this same turn so the runtime emits an Action. " +
      "Do not ask me for another chat message.",
  );
  await expect(page.getByTestId("transaction-review")).toBeVisible({
    timeout: 300_000,
  });

  expect(starts.length).toBeGreaterThan(0);
  const userState = starts[0].userState as {
    evm?: Record<string, unknown>;
  };
  expect(userState?.evm?.address?.toString().toLowerCase()).toBe(
    walletAddress.toLowerCase(),
  );
  expect(userState?.evm).not.toHaveProperty("broadcaster");
  await expect
    .poll(() => actions.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  expect(actions[0].request?.type).toBe("execute_evm");
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
  await expect(input).toHaveAttribute("contenteditable", "true");
  await input.pressSequentially(message);
  await expect(input).toHaveText(message);
  await expect(submit).toBeEnabled();
  await submit.click();
}
