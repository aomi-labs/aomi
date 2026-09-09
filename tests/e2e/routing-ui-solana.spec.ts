import { expect, test, type Page } from "@playwright/test";

/**
 * S-Wallet-Manual-UI: a Solana wallet approves an Action and the E2E wallet
 * signs it through the portal's Solana BFF route, never the EVM execute route.
 *
 * Preconditions: E2E wallet with a Solana signer configured
 * (AOMI_E2E_SOLANA_SIGNER_PRIVATE_KEY or AOMI_E2E_SOLANA_KEYPAIR_PATH) and a
 * loopback Solana RPC; AOMI_E2E_SVM_ADDRESS names the seeded pubkey.
 */
const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";
const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
const evmAddress =
  process.env.AOMI_E2E_WALLET_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const svmAddress = process.env.AOMI_E2E_SVM_ADDRESS;
const svmCluster = process.env.AOMI_E2E_SVM_CLUSTER ?? "solana:devnet";

test.describe.configure({ mode: "serial", timeout: 10 * 60_000 });

test("a Solana Action is signed through the Solana BFF route", async ({
  page,
}) => {
  test.skip(!walletToken, "AOMI_E2E_WALLET_TOKEN is required");
  test.skip(!svmAddress, "AOMI_E2E_SVM_ADDRESS is required");

  let evmExecuteCalled = false;
  await page.route("**/api/bff/e2e/execute", async (route) => {
    evmExecuteCalled = true;
    await route.continue();
  });
  const solanaResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/bff/e2e/solana") &&
      response.request().method() === "POST",
    { timeout: 240_000 },
  );

  const seed = new URL("/api/bff/e2e/wallet", portalOrigin);
  seed.searchParams.set("token", walletToken!);
  seed.searchParams.set("address", evmAddress);
  seed.searchParams.set("chainId", "31337");
  seed.searchParams.set("svmAddress", svmAddress!);
  seed.searchParams.set("svmCluster", svmCluster);
  seed.searchParams.set("redirect", "/");
  await page.goto(seed.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  await send(
    page,
    `ROUTING SOLANA: transfer 0 SOL from my connected Solana wallet to itself (${svmAddress}) on ${svmCluster}. ` +
      "Stage it and call the Solana commit tool in this same turn so the runtime emits an Action. " +
      "Do not ask me for another chat message.",
  );
  await expect(page.getByRole("heading", { name: /Review/ })).toBeVisible({
    timeout: 180_000,
  });
  await page.getByRole("button", { name: "Approve" }).click();
  const response = await solanaResponse;
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { signature?: string };
  expect(body.signature).toBeTruthy();
  expect(evmExecuteCalled).toBe(false);
});

async function send(page: Page, message: string): Promise<void> {
  const input = page.getByRole("textbox", { name: "Message input" });
  const submit = page.getByRole("button", { name: "Send message" });
  await input.fill(message);
  await expect(input).toHaveValue(message);
  await expect(submit).toBeEnabled();
  await submit.click();
}
