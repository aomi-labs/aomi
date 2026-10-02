import { chromium, expect, test } from "@playwright/test";
import { installBrowserWallet } from "./hosted-wallet-fixture";
import {
  expectVerifiedBffRecord,
  fixtureKeys,
  portalAccount,
  requiredOrigin,
  resetContractState,
  sendPrompt,
  signInThroughUi,
  signOutThroughUi,
  upstreamRecords,
} from "./browser-contract-helpers";

const portalOrigin = requiredOrigin("BROWSER_CONTRACT_PORTAL_URL");
const keys = fixtureKeys();

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
    page.getByRole("dialog", { name: "Finish signing in" }),
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
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Manage account" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Add more", exact: true }).click();
  const picker = page.getByRole("dialog", { name: /Add a wallet/ });
  const link = picker.getByRole("button", { name: "Link wallet", exact: true });
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

test("saved Rabby reconnect recovers after browser restart, repeated attempts and interruption", async ({}, testInfo) => {
  testInfo.setTimeout(150_000);
  const firstBrowser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  let restartedBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const first = await firstBrowser.newPage();
    const { wallet } = await signInThroughUi(first, {
      family: "evm",
      pageOrigin: portalOrigin,
      challengeOrigin: portalOrigin,
      privateKeys: keys.evm,
      evmBrand: "Rabby",
    });
    const account = await portalAccount(first);
    const savedState = await first.context().storageState();
    await firstBrowser.close();

    restartedBrowser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    });
    const context = await restartedBrowser.newContext({
      storageState: savedState,
    });
    const page = await context.newPage();
    const restored = await installBrowserWallet(page, {
      family: "evm",
      pageOrigin: portalOrigin,
      evmPrivateKeys: keys.evm,
      evmBrand: "Rabby",
      initialAccountIndex: 1,
    });
    await page.goto(portalOrigin, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Open account menu" }),
    ).toBeVisible({ timeout: 30_000 });
    const openSettings = async () => {
      await page.getByRole("button", { name: "Open account menu" }).click();
      await page.getByRole("button", { name: "Manage account" }).click();
      const settings = page.getByRole("dialog", {
        name: "Settings",
        exact: true,
      });
      await expect(settings).toBeVisible();
      return settings;
    };
    const settings = await openSettings();
    await expect(
      settings.getByText("Not on this device", { exact: true }),
    ).toBeVisible();
    for (let attempt = 0; attempt < 2; attempt++) {
      await settings
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await expect(
        settings.getByText(/Select .* in Rabby, then click Connect again/),
      ).toBeVisible();
      await expect(
        settings.getByText("Not on this device", { exact: true }),
      ).toBeVisible();
      await expect(
        settings.getByText(/Connector already connected/),
      ).toHaveCount(0);
    }
    await page.screenshot({
      path: testInfo.outputPath("rabby-reconnect-guidance-desktop.png"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("rabby-reconnect-guidance-mobile.png"),
    });

    // Pause the provider read, dismiss Settings, then let the request finish.
    // Reopening must allow another attempt without signing out.
    await page.evaluate(() => {
      const windowFixture = window as unknown as {
        ethereum: { request: (input: { method: string }) => Promise<unknown> };
        __releaseRabbyRead?: () => void;
      };
      const original = windowFixture.ethereum.request.bind(
        windowFixture.ethereum,
      );
      let pause = true;
      windowFixture.ethereum.request = async (input) => {
        if (input.method === "eth_accounts" && pause) {
          pause = false;
          await new Promise<void>((resolve) => {
            windowFixture.__releaseRabbyRead = resolve;
          });
        }
        return original(input);
      };
    });
    await settings
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (window as unknown as { __releaseRabbyRead?: unknown })
              .__releaseRabbyRead,
          ),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await page.evaluate(() =>
      (
        window as unknown as { __releaseRabbyRead: () => void }
      ).__releaseRabbyRead(),
    );
    await restored.switchAccount(0, false);
    await openSettings();
    await settings
      .getByRole("button", { name: "Connect", exact: true })
      .click();
    await expect(
      settings.getByText("Not on this device", { exact: true }),
    ).toHaveCount(0);
    await expect(
      settings.getByRole("button", { name: "Connect", exact: true }),
    ).toHaveCount(0);
    await expect(settings.getByText(/Connector already connected/)).toHaveCount(
      0,
    );
    expect((await portalAccount(page)).user?.id).toBe(account.user?.id);
    expect((await portalAccount(page)).wallets?.length).toBe(1);
    expect(restored.signatureCount).toBe(0);
    expect(wallet.signatureCount).toBe(1);
    expect(restored.blocked).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("rabby-reconnect-recovered-mobile.png"),
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({
      path: testInfo.outputPath("rabby-reconnect-recovered-desktop.png"),
    });
  } finally {
    await firstBrowser.close();
    await restartedBrowser?.close();
  }
});
