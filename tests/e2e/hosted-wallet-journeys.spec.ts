import { expect, test, type Page } from "@playwright/test";
import {
  BURN_ADDRESS,
  ONE_WEI_DISPLAY,
  hostedEvmAddress,
  hostedPortalUrl,
  installHostedWallet,
  type WalletFamily,
} from "./hosted-wallet-fixture";

type Account = {
  guest?: boolean;
  user?: { id?: string } | null;
  wallets?: Array<{ family?: string; address?: string }>;
  session?: { carrier?: string; betterAuthUserId?: string } | null;
};
type Session = { user?: { id?: string; isAnonymous?: boolean } } | null;

async function browserJson<T>(page: Page, path: string): Promise<T> {
  return page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { credentials: "include" });
    if (!response.ok)
      throw new Error(`${endpoint} returned HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }, path);
}

async function signIn(page: Page, family: WalletFamily, chainId = 84532) {
  const wallet = await installHostedWallet(page, family, chainId);
  const forbiddenRequests: string[] = [];
  const authStatuses: string[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (
      path.startsWith("/api/auth/") &&
      response.request().method() === "POST"
    ) {
      authStatuses.push(`${response.status()} ${path}`);
    }
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (
      /\/(?:api\/bff\/e2e\/execute|v1\/agent\/actions\/[^/]+\/(?:approve|execute)|broadcast)(?:\/|$)/.test(
        path,
      ) ||
      /"method"\s*:\s*"(?:eth_sendRawTransaction|eth_sendTransaction|solana_sendTransaction)"/.test(
        request.postData() ?? "",
      )
    ) {
      forbiddenRequests.push(`${request.method()} ${path}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(hostedPortalUrl(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  const cookies = page.getByRole("button", { name: "Decline", exact: true });
  if (await cookies.isVisible()) await cookies.click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click({
    timeout: 15_000,
  });
  const picker = page.getByRole("dialog", {
    name: /Sign in to Aomi|Add a wallet/,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", {
      name: family === "evm" ? "Connect MetaMask" : "Connect Phantom",
    })
    .click();
  const finish = page
    .getByRole("dialog", { name: "Finish signing in" })
    .getByRole("button", {
      name: "Link wallet and sign in",
    });
  await expect(finish).toBeEnabled({ timeout: 30_000 });
  await finish.click();
  const segment = family === "evm" ? "siwe" : "siws";
  await expect
    .poll(() => authStatuses, { timeout: 30_000 })
    .toContain(`200 /api/auth/${segment}/verify`);
  expect(authStatuses).toContain(`200 /api/auth/${segment}/nonce`);
  expect(authStatuses).toContain(`200 /api/auth/${segment}/verify`);
  expect(wallet.signatureCount).toBe(1);
  await expect
    .poll(
      async () =>
        Boolean(
          (await browserJson<Session>(page, "/api/auth/get-session"))?.user?.id,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
  const session = await browserJson<Session>(page, "/api/auth/get-session");
  const account = await browserJson<Account>(page, "/v1/account");
  expect(session?.user?.id).toBeTruthy();
  expect(session?.user?.isAnonymous).not.toBe(true);
  expect(account.guest).not.toBe(true);
  expect(account.user?.id).toBeTruthy();
  expect(account.session?.carrier).toBe("better_auth");
  expect(account.session?.betterAuthUserId).toBe(session?.user?.id);
  expect(
    account.wallets?.some(
      (entry) =>
        entry.family === family &&
        entry.address?.toLowerCase() === wallet.address.toLowerCase(),
    ),
  ).toBe(true);
  expect(wallet.blocked).toEqual([]);
  expect(forbiddenRequests).toEqual([]);
  return { wallet, account, forbiddenRequests };
}

async function sendPrompt(page: Page, message: string) {
  const input = page.getByRole("textbox", { name: "Message input" });
  await expect(input).toHaveAttribute("contenteditable", "true");
  await input.fill(message);
  const firstChat = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/agent/chat" &&
      response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const response = await firstChat;
  expect(
    response.status(),
    `Chat start returned HTTP ${response.status()}`,
  ).toBe(200);
  return response;
}

async function expectSettledReply(
  page: Page,
  response: Awaited<ReturnType<typeof sendPrompt>>,
) {
  const first = (await response.json()) as {
    session_id?: string;
    events?: Array<{
      type?: string;
      sender?: string;
      content?: string;
      state?: string;
    }>;
  };
  if (!first.session_id) throw new Error("Hosted chat returned no session id");
  await expect
    .poll(
      async () => {
        const current = await browserJson<typeof first>(
          page,
          `/v1/agent/chat/${encodeURIComponent(first.session_id!)}`,
        );
        const events = [...(first.events ?? []), ...(current.events ?? [])];
        return {
          reply: events.some(
            (event) =>
              event.type === "message" &&
              event.sender === "agent" &&
              Boolean(event.content?.trim()),
          ),
          settled: events.some(
            (event) =>
              event.type === "turn_state_changed" && event.state === "complete",
          ),
        };
      },
      { timeout: 110_000 },
    )
    .toEqual({ reply: true, settled: true });
}

for (const family of ["evm", "svm"] as const) {
  test(`${family.toUpperCase()} wallet signs a real challenge and gets a settled hosted reply`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { wallet, forbiddenRequests } = await signIn(page, family);
    const response = await sendPrompt(
      page,
      "Reply with a short greeting for this wallet login test.",
    );
    await expectSettledReply(page, response);
    await expect(
      page
        .locator(".aui-assistant-message-root")
        .filter({ hasText: /\S/ })
        .last(),
    ).toBeVisible({ timeout: 110_000 });
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeEnabled({ timeout: 110_000 });
    expect(wallet.blocked).toEqual([]);
    expect(forbiddenRequests).toEqual([]);
  });
}

test("EVM wallet receives a signable 1-wei burn transfer with a visible simulated decrease", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const chainId = Number(process.env.AOMI_HOSTED_E2E_CHAIN_ID);
  if (chainId !== 84532)
    throw new Error(
      "AOMI_HOSTED_E2E_CHAIN_ID must select staging-supported Base Sepolia (84532)",
    );
  const expectedAddress = hostedEvmAddress();
  await assertFundedTestWallet(expectedAddress, chainId);
  const { wallet, forbiddenRequests } = await signIn(page, "evm", chainId);
  expect(wallet.address.toLowerCase()).toBe(expectedAddress.toLowerCase());
  await sendPrompt(
    page,
    `Prepare a native-token transfer of exactly 1 wei on chain ${chainId} from my connected wallet to the burn address ${BURN_ADDRESS}. Construct and simulate it, then call commit_txs so I can review the pending wallet approval. Do not sign or broadcast.`,
  );
  const review = page.getByTestId("transaction-review");
  await expect(review).toBeVisible({ timeout: 150_000 });
  await review.getByText("Transaction details").click();
  const request = JSON.parse(
    await review.locator("details").first().locator("pre").innerText(),
  ) as {
    type: string;
    transactions?: Array<{
      from: string;
      to: string;
      chain_id: number;
      value?: string;
      data: string;
    }>;
    simulation?: {
      status?: string;
      balanceChanges?: Array<{
        asset: string;
        direction: string;
        amount: string;
      }>;
      approvals?: unknown[];
      fees?: unknown[];
    };
  };
  expect(request.type).toBe("execute_evm");
  expect(request.transactions).toHaveLength(1);
  const tx = request.transactions![0];
  expect(tx.from.toLowerCase()).toBe(wallet.address.toLowerCase());
  expect(tx.to.toLowerCase()).toBe(BURN_ADDRESS);
  expect(tx.chain_id).toBe(chainId);
  expect(tx.value).toBe("1");
  expect(tx.data).toBe("0x");
  expect(request.simulation?.status).toBe("passed");
  expect(request.simulation?.approvals).toEqual([]);
  expect(
    request.simulation?.balanceChanges?.some(
      (change) =>
        change.asset === "native" &&
        change.direction === "out" &&
        change.amount === "1",
    ),
  ).toBe(true);
  await expect(
    review.getByRole("region", { name: "Simulated wallet impact" }),
  ).toHaveAttribute("data-change-count", /[1-9]/);
  await expect(
    review.getByTestId("asset-effect").filter({ hasText: ONE_WEI_DISPLAY }),
  ).toBeVisible();
  expect(wallet.blocked).toEqual([]);
  expect(forbiddenRequests).toEqual([]);
});

async function assertFundedTestWallet(address: string, chainId: number) {
  const rpcUrl = process.env.AOMI_HOSTED_E2E_RPC_URL;
  if (!rpcUrl)
    throw new Error(
      "AOMI_HOSTED_E2E_RPC_URL is required for balance and chain preflight",
    );
  try {
    if (new URL(rpcUrl).protocol !== "https:")
      throw new Error("Hosted E2E RPC must use HTTPS");
  } catch {
    throw new Error("Hosted E2E RPC must be a valid HTTPS URL");
  }
  async function rpc(method: string, params: unknown[]) {
    const response = await fetch(rpcUrl!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Staging RPC returned HTTP ${response.status}`);
    const body = (await response.json()) as {
      result?: string;
      error?: { code?: number };
    };
    if (body.error || !body.result)
      throw new Error(`Staging RPC ${method} unavailable`);
    return body.result;
  }
  const actualChainId = Number(BigInt(await rpc("eth_chainId", [])));
  if (actualChainId !== chainId)
    throw new Error("Configured staging RPC chain differs from E2E chain");
  const balance = BigInt(await rpc("eth_getBalance", [address, "latest"]));
  const fee = BigInt(await rpc("eth_gasPrice", [])) * 21_000n;
  if (balance <= fee + 1n)
    throw new Error(
      "Dedicated Base Sepolia test wallet lacks native token for 1 wei plus estimated fees",
    );
}
