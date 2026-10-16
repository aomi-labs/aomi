import { expect, test } from "@playwright/test";
import {
  expectVerifiedBffRecord,
  portalAccount,
  requiredOrigin,
  resetContractState,
  seedCommit,
  sendPrompt,
  signInThroughUi,
  signOutThroughUi,
  upstreamRecords,
} from "./browser-contract-helpers";
import { fixtureKeys } from "./fixture-wallets";

const portalOrigin = requiredOrigin("BROWSER_CONTRACT_PORTAL_URL");
const keys = fixtureKeys;

test.beforeEach(async () => resetContractState());
test.beforeEach(async ({}, testInfo) => testInfo.setTimeout(90_000));

for (const family of ["evm", "svm"] as const) {
  test(`${family.toUpperCase()} signs in through production Portal and preserves its canonical session`, async ({
    page,
  }) => {
    const { wallet, verified } = await signInThroughUi(page, {
      family,
      pageOrigin: portalOrigin,
      challengeOrigin: portalOrigin,
      privateKeys: family === "evm" ? [keys.evm[0]!] : undefined,
      svmSecretKey: family === "svm" ? keys.svm : undefined,
    });
    expect(verified?.status()).toBe(200);
    expect(wallet.signatureCount).toBe(1);
    const account = await portalAccount(page);
    expect(account.guest).not.toBe(true);
    expect(account.user?.id).toBeTruthy();
    expect(account.session).toMatchObject({ carrier: "better_auth" });
    expect(
      account.wallets?.some(
        (entry) =>
          entry.family === family &&
          entry.address?.toLowerCase() === wallet.address.toLowerCase(),
      ),
    ).toBe(true);

    const message = `${family} production contract`;
    await sendPrompt(page, message);
    const chat = (await upstreamRecords()).find(
      (record) => record.method === "POST" && record.path === "/v1/agent/chat",
    );
    expectVerifiedBffRecord(chat, account.user!.id!, "session");
    expect(wallet.blocked).toEqual([]);

    if (family === "evm") {
      const settingsRequests: string[] = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (
          path === "/v1/account" ||
          path === "/v1/account/credits" ||
          path === "/api/account"
        )
          settingsRequests.push(path);
      });
      let firstOpenRequests = 0;
      for (let open = 0; open < 2; open++) {
        await page
          .getByRole("button", { name: "Open settings", exact: true })
          .click();
        const settings = page.getByRole("dialog", {
          name: "Settings",
          exact: true,
        });
        await expect(
          settings.getByRole("navigation", { name: "Settings sections" }),
        ).toBeVisible();
        await settings
          .getByRole("button", { name: "Account", exact: true })
          .click();
        await expect(
          settings.getByRole("heading", { name: "Account", exact: true }),
        ).toBeVisible();
        await expect(
          settings.getByRole("button", { name: "Sign out", exact: true }),
        ).toBeVisible();
        await settings
          .getByRole("button", { name: "Close settings", exact: true })
          .click();
        await expect(settings).toBeHidden();
        if (open === 0) firstOpenRequests = settingsRequests.length;
        else expect(settingsRequests).toHaveLength(firstOpenRequests);
      }
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Open account menu" }),
    ).toBeVisible({
      timeout: 30_000,
    });
    expect((await portalAccount(page)).user?.id).toBe(account.user?.id);
    expect(wallet.signatureCount).toBe(1);
  });
}

test("rejected first-party wallet signature leaves no durable signed-in account", async ({
  page,
}) => {
  const { wallet, verified } = await signInThroughUi(page, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
    rejectSignatures: true,
  });
  expect(verified).toBeUndefined();
  expect(wallet.signatureCount).toBe(0);
  await expect(
    page.getByRole("dialog", { name: "Check MetaMask" }),
  ).toBeVisible();
  const session = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", {
      credentials: "include",
    });
    return response.json();
  });
  expect(session?.user?.isAnonymous).not.toBe(false);
});

test("explicit UI wallet linking adds a second key to the same canonical user", async ({
  page,
}) => {
  const { wallet } = await signInThroughUi(page, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: keys.evm,
  });
  const before = await portalAccount(page);
  await wallet.switchAccount(1);
  const picker = page.getByRole("dialog", { name: "New address in MetaMask" });
  await expect(picker).toBeVisible();
  const link = picker.getByRole("button", {
    name: "Verify and add to account",
    exact: true,
  });
  await expect(link).toBeEnabled({ timeout: 30_000 });
  await link.click();
  await expect
    .poll(async () => (await portalAccount(page)).wallets?.length, {
      timeout: 30_000,
    })
    .toBe(2);
  const after = await portalAccount(page);
  expect(after.user?.id).toBe(before.user?.id);
  expect(after.wallets?.map((entry) => entry.address?.toLowerCase())).toEqual(
    expect.arrayContaining(
      wallet.addresses.map((address) => address.toLowerCase()),
    ),
  );
  expect(wallet.signatureCount).toBe(2);
});

test("sign-out and account switching isolate agent history", async ({
  page,
}) => {
  const first = await signInThroughUi(page, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
  });
  const firstAccount = await portalAccount(page);
  await sendPrompt(page, "private history for account one");
  await signOutThroughUi(page);

  await first.wallet.switchAccount(0);
  await page.close();
  const secondPage = await page.context().newPage();
  await signInThroughUi(secondPage, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[1]!],
  });
  const secondAccount = await portalAccount(secondPage);
  expect(secondAccount.user?.id).not.toBe(firstAccount.user?.id);
  const sessions = await secondPage.evaluate(async () => {
    const response = await fetch("/v1/agent/sessions", {
      credentials: "include",
    });
    return response.json();
  });
  expect(JSON.stringify(sessions)).not.toContain(
    "private history for account one",
  );
});

test("a sign link is login-only and returns to its review after sign-in", async ({
  page,
}) => {
  const ref = "cmt_contract";
  const signer = keys.evmAddress;
  await signInThroughUi(page, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
  });
  const owner = (await portalAccount(page)).user!.id!;
  await seedCommit(ref, owner, {
    version: 1,
    commit_id: ref,
    thread_id: "cli-thread",
    stage_id: "direct:contract:0",
    chain_family: "evm",
    chain_ref: "84532",
    signer,
    broadcaster: "wallet",
    state: "needs_signature",
    transaction_id: null,
    failure_code: null,
    batch: null,
    wallet_attempt: null,
    action: {
      kind: "sign",
      payload: {
        kind: "evm_transaction",
        chain_id: 84532,
        signer,
        transaction: {
          to: "0x2222222222222222222222222222222222222222",
          data: "0x",
          value: "0",
          nonce: 0,
          gas: "21000",
          max_fee_per_gas: "1",
          max_priority_fee_per_gas: "1",
        },
      },
    },
    review: {
      version: 1,
      revision: 1,
      digest: "contract-digest",
      request: {
        type: "execute_evm",
        transactions: [
          {
            chain_id: 84532,
            from: signer,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Contract transfer",
            kind: "transaction",
          },
        ],
        simulation: {
          status: "passed",
          balanceChanges: [],
          approvals: [],
          warnings: [],
          fees: [],
          guards: [],
          gas: null,
          logs: [],
        },
      },
      legs: [],
    },
    origin: "cli",
    origin_app: null,
    initiator: "cli",
    notify: "cli",
    sign_url: `${portalOrigin}/sign/${ref}`,
    created_at: Math.floor(Date.now() / 1000) - 120,
  });
  await signOutThroughUi(page);
  await page.close();

  // Signed out, the sign page itself opens the wallet picker with its
  // purpose; closed, it leaves a Sign in sheet that reopens it.
  const signedOut = await page.context().newPage();
  await signedOut.goto(`${portalOrigin}/sign/${ref}`);
  const picker = signedOut.getByRole("dialog", { name: "Sign in to Aomi" });
  await expect(picker.getByText("To review a trade")).toBeVisible({
    timeout: 30_000,
  });
  await picker.getByRole("button", { name: "Close" }).click();

  await signInThroughUi(signedOut, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
    navigate: false,
    expectAccountMenu: false,
  });
  await expect(signedOut).toHaveURL(`${portalOrigin}/sign/${ref}`);
  const request = signedOut.getByRole("region", {
    name: "Transaction request",
  });
  await expect(request).toBeVisible({ timeout: 30_000 });
  await expect(signedOut.getByText("From CLI · 2 minutes ago")).toBeVisible();
  await expect(
    request.getByRole("region", { name: "Wallet impact", exact: true }),
  ).toBeVisible();
  await expect(request.getByText("Simulation passed")).toBeVisible();
  await expect(
    request.getByRole("button", { name: "Submit", exact: true }),
  ).toBeVisible();
  await expect(
    request.getByRole("button", { name: "Reject", exact: true }),
  ).toBeVisible();
  await expect(request.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  const read = (await upstreamRecords()).find(
    (record) => record.path === `/v1/commits/${ref}`,
  );
  expect(read?.principal?.sub).toBe(owner);
  expect(read?.headers["x-thread-id"]).toBeUndefined();
});

test("a portal session approves a parked agent-wallet commit on its sign page", async ({
  page,
}) => {
  const ref = "5f0c2a1e-8d4b-4c3a-9e7f-1b2c3d4e5f60";
  const agent = "0x7a3f00000000000000000000000000000000c41e";
  await signInThroughUi(page, {
    family: "evm",
    pageOrigin: portalOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
  });
  const owner = (await portalAccount(page)).user!.id!;
  await seedCommit(ref, owner, {
    version: 2,
    commit_id: ref,
    thread_id: "mcp-thread",
    stage_id: "direct:approval:0",
    chain_family: "evm",
    chain_ref: "84532",
    signer: agent,
    broadcaster: "hosted",
    state: "awaiting_approval",
    signing_mode: "auto",
    transaction_id: null,
    failure_code: null,
    batch: null,
    wallet_attempt: null,
    action: null,
    approval: {
      state: "pending",
      client: "oauth:contract",
      expires_at: 1_900_000_000,
    },
    review: {
      version: 2,
      revision: 1,
      digest: "approval-digest",
      request: {
        type: "execute_evm",
        transactions: [
          {
            chain_id: 84532,
            from: agent,
            to: "0x2222222222222222222222222222222222222222",
            data: "0x",
            label: "Agent transfer",
            kind: "transaction",
          },
        ],
        simulation: {
          status: "passed",
          balanceChanges: [],
          approvals: [],
          warnings: [],
          fees: [],
          guards: [],
          gas: null,
          logs: [],
        },
      },
      legs: [],
    },
    origin: "mcp",
    origin_app: null,
    initiator: "oauth:contract",
    notify: "oauth:contract",
    sign_url: `${portalOrigin}/sign/${ref}`,
    created_at: Math.floor(Date.now() / 1000) - 60,
  });

  await page.goto(`${portalOrigin}/sign/${ref}`);
  const request = page.getByRole("region", { name: "Transaction request" });
  await expect(request).toBeVisible({ timeout: 30_000 });
  await expect(
    request.getByText("Aomi signs with your agent wallet after you approve."),
  ).toBeVisible();
  // No wallet to connect: Aomi signs with the agent wallet after Approve.
  await expect(
    request.getByRole("button", { name: /Connect wallet|Switch to/ }),
  ).toHaveCount(0);
  await request.getByRole("button", { name: "Approve", exact: true }).click();
  // Approve spins in place while Aomi signs; there is no "Signing…" screen.
  await expect(request.getByRole("button", { name: /Working…/ })).toBeVisible({
    timeout: 30_000,
  });

  const approve = (await upstreamRecords()).find(
    (record) =>
      record.method === "POST" && record.path === `/v1/commits/${ref}/approve`,
  );
  expect(approve?.principal?.sub).toBe(owner);
  expect(approve?.principal?.auth_source).toBe("session");
});
