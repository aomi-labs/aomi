import { createRequire } from "node:module";
import { expect, type Page, type Response } from "@playwright/test";
import {
  installBrowserWallet,
  type WalletFamily,
} from "./hosted-wallet-fixture";

export type AccountSnapshot = {
  guest?: boolean;
  user?: { id?: string } | null;
  wallets?: Array<{ family?: string; address?: string }>;
  session?: {
    carrier?: string;
    betterAuthUserId?: string;
    authMethod?: string;
  } | null;
};

export type UpstreamRecord = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  authorization: "verified-bff-bearer" | "absent";
  cookie: "present" | "absent";
  principal: {
    sub?: string;
    iss?: string;
    aud?: string | string[];
    role?: string;
    scope?: string;
    resource?: string;
    auth_source?: string;
    principal_class?: string;
    sid?: string;
    kid?: string;
  } | null;
};

const accountRequire = createRequire(
  new URL("../../packages/account/package.json", import.meta.url),
);
const { Pool } = accountRequire("pg") as {
  Pool: new (input: { connectionString?: string }) => {
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
};

export function requiredOrigin(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return new URL(value).origin;
}

export function fixtureKeys(): { evm: string[]; svm: string } {
  const evm =
    process.env.BROWSER_CONTRACT_EVM_PRIVATE_KEYS?.split(",").filter(Boolean);
  const svm = process.env.BROWSER_CONTRACT_SVM_SEED;
  if (!evm || evm.length < 2 || !svm) {
    throw new Error("Ephemeral browser contract wallet keys are required");
  }
  return { evm, svm };
}

export async function jsonFromPage<T>(
  page: Page,
  url: string,
  init?: RequestInit,
): Promise<T> {
  return page.evaluate(
    async ({ endpoint, requestInit }) => {
      const response = await fetch(endpoint, requestInit);
      if (!response.ok) {
        throw new Error(`${endpoint} returned HTTP ${response.status}`);
      }
      return response.json() as Promise<T>;
    },
    { endpoint: url, requestInit: init },
  );
}

export async function resetUpstream(): Promise<void> {
  const response = await fetch(
    `${requiredOrigin("BROWSER_CONTRACT_UPSTREAM_URL")}/__reset`,
    {
      method: "POST",
    },
  );
  if (!response.ok)
    throw new Error(`Upstream reset failed: ${response.status}`);
}

export async function resetContractState(): Promise<void> {
  await resetUpstream();
  const pool = new Pool({
    connectionString: process.env.AOMI_TEST_DATABASE_URL,
  });
  try {
    await pool.query(
      `truncate table
         public_keys,
         auth_providers,
         users,
         ba_accounts,
         ba_sessions,
         ba_verifications,
         ba_wallet_addresses,
         ba_users
       restart identity cascade`,
    );
  } finally {
    await pool.end();
  }
}

export async function upstreamRecords(): Promise<UpstreamRecord[]> {
  const response = await fetch(
    `${requiredOrigin("BROWSER_CONTRACT_UPSTREAM_URL")}/__records`,
  );
  if (!response.ok)
    throw new Error(`Upstream records failed: ${response.status}`);
  return ((await response.json()) as { records: UpstreamRecord[] }).records;
}

export async function declineCookies(page: Page): Promise<void> {
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  await decline.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  if (await decline.isVisible()) await decline.click();
}

export async function signInThroughUi(
  page: Page,
  input: {
    family: WalletFamily;
    pageOrigin: string;
    challengeOrigin: string;
    privateKeys?: string[];
    svmSecretKey?: string;
    rejectSignatures?: boolean;
    navigate?: boolean;
  },
) {
  const wallet = await installBrowserWallet(page, {
    family: input.family,
    pageOrigin: input.pageOrigin,
    evmPrivateKeys: input.privateKeys,
    svmSecretKey: input.svmSecretKey,
    rejectSignatures: input.rejectSignatures,
  });
  if (input.navigate !== false) {
    await page.goto(input.pageOrigin, { waitUntil: "domcontentloaded" });
  }
  if (input.pageOrigin === input.challengeOrigin) {
    await declineCookies(page);
  }
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: /Sign in to Aomi|Add a wallet/,
  });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", {
      name: input.family === "evm" ? "Connect MetaMask" : "Connect Phantom",
    })
    .click();
  const finishDialog = page.getByRole("dialog", { name: "Finish signing in" });
  const finish = finishDialog.getByRole("button", {
    name: "Link wallet and sign in",
  });
  await expect(finish).toBeEnabled({ timeout: 30_000 });
  const verifyPath =
    input.pageOrigin === input.challengeOrigin
      ? `/api/auth/${input.family === "evm" ? "siwe" : "siws"}/verify`
      : `/api/auth/widget/${input.family === "evm" ? "siwe" : "siws"}/verify`;
  const verified = input.rejectSignatures
    ? undefined
    : page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === verifyPath &&
          response.request().method() === "POST",
      );
  await finish.click();
  if (input.rejectSignatures) {
    await expect(finishDialog).toBeVisible();
    return { wallet, verified: undefined };
  }
  const verifiedResponse = await verified!;
  await expect(finishDialog).toBeHidden({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toBeVisible({ timeout: 30_000 });
  return { wallet, verified: verifiedResponse };
}

export async function sendPrompt(
  page: Page,
  message: string,
  options: { expectReply?: boolean; expectComposerReady?: boolean } = {},
): Promise<Response> {
  const input = page.getByRole("textbox", { name: "Message input" });
  await expect(input).toHaveAttribute("contenteditable", "true", {
    timeout: 30_000,
  });
  await input.fill(message);
  const started = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/v1/agent/chat" &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const response = await started;
  expect(response.status()).toBe(200);
  if (options.expectReply !== false) {
    await expect(
      page
        .locator(".aui-assistant-message-root")
        .filter({ hasText: `Controlled reply for ${message}` }),
    ).toBeVisible({ timeout: 30_000 });
  }
  if (options.expectComposerReady !== false) {
    await expect(
      page.getByRole("button", { name: "Send message" }),
    ).toBeEnabled({ timeout: 30_000 });
  }
  return response;
}

export function expectVerifiedBffRecord(
  record: UpstreamRecord | undefined,
  userId: string,
  authSource: string,
  principalClass = "user",
): void {
  expect(record).toBeTruthy();
  expect(record?.authorization).toBe("verified-bff-bearer");
  expect(record?.cookie).toBe("absent");
  expect(record?.principal).toMatchObject({
    sub: userId,
    iss: "aomi-bff",
    aud: "aomi-api-server",
    role: "user",
    auth_source: authSource,
    principal_class: principalClass,
    kid: "aomi-bff-dev-1",
  });
  expect(record?.headers["x-aomi-user-id"]).toBeUndefined();
  expect(record?.headers["x-aomi-principal-id"]).toBeUndefined();
}

export async function portalAccount(page: Page): Promise<AccountSnapshot> {
  return jsonFromPage<AccountSnapshot>(page, "/v1/account", {
    credentials: "include",
  });
}

export async function signOutThroughUi(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("button", { name: "Session & wallet" }).click();
  await page.getByRole("button", { name: /^Sign out/ }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out of Aomi?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
}
