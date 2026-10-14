import { expect, test } from "@playwright/test";
import {
  expectVerifiedBffRecord,
  portalAccount,
  requiredOrigin,
  resetContractState,
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
