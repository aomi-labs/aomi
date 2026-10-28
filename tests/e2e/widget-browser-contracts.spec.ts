import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import {
  expectVerifiedBffRecord,
  jsonFromPage,
  requiredOrigin,
  resetContractState,
  sendPrompt,
  signInThroughUi,
  upstreamRecords,
  type AccountSnapshot,
} from "./browser-contract-helpers";
import { fixtureKeys } from "./fixture-wallets";

const portalOrigin = requiredOrigin("BROWSER_CONTRACT_PORTAL_URL");
const consumerOrigin = requiredOrigin("BROWSER_CONTRACT_CONSUMER_URL");
const rejectedOrigin = requiredOrigin("BROWSER_CONTRACT_REJECTED_CONSUMER_URL");
const keys = fixtureKeys;
const accountRequire = createRequire(
  new URL("../../packages/account/package.json", import.meta.url),
);
const { Pool } = accountRequire("pg") as {
  Pool: new (input: { connectionString?: string }) => {
    query(sql: string): Promise<{ rowCount: number | null }>;
    end(): Promise<void>;
  };
};

type WidgetSession = {
  access_token: string;
  expires_at: number;
  user: { id: string };
};

test.beforeEach(async () => resetContractState());
test.beforeEach(async ({}, testInfo) => testInfo.setTimeout(90_000));

test("packaged guest widget uses readable CORS, a verified BFF assertion, and nonpersistent history", async ({
  page,
}) => {
  await page.goto(consumerOrigin, { waitUntil: "domcontentloaded" });
  const firstGuest = waitForWidgetSession(page, "/api/auth/guest");
  const chatResponse = await sendPrompt(
    page,
    "anonymous cross-origin contract",
  );
  const first = await firstGuest;
  expect(first.response.headers()["access-control-allow-origin"]).toBe(
    consumerOrigin,
  );
  expect(chatResponse.headers()["access-control-allow-origin"]).toBe(
    consumerOrigin,
  );
  const chat = (await upstreamRecords()).find(
    (record) => record.method === "POST" && record.path === "/v1/agent/chat",
  );
  expectVerifiedBffRecord(chat, first.session.user.id, "widget", "guest");

  const secondGuest = waitForWidgetSession(page, "/api/auth/guest");
  await page.reload({ waitUntil: "domcontentloaded" });
  await sendPrompt(page, "fresh anonymous widget session");
  const second = await secondGuest;
  expect(second.session.access_token).not.toBe(first.session.access_token);
  expect(second.session.user.id).not.toBe(first.session.user.id);
  const history = await widgetJson(
    page,
    second.session.access_token,
    "/v1/agent/sessions",
  );
  expect(JSON.stringify(history)).not.toContain(
    "anonymous cross-origin contract",
  );
});

test("an invalid explicit widget credential fails closed and preserves upstream errors", async ({
  page,
}) => {
  await page.goto(consumerOrigin, { waitUntil: "domcontentloaded" });
  const issued = await rawWidgetFetch(page, "/api/auth/guest", {
    method: "POST",
    body: {},
  });
  expect(issued.status).toBe(200);
  const valid = (issued.body as WidgetSession).access_token;
  let guestRefreshes = 0;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/auth/guest") {
      guestRefreshes += 1;
    }
  });
  const invalid = await rawWidgetFetch(page, "/v1/agent/sessions", {
    token: "aomi_wst_intentionally_invalid",
  });
  expect(invalid.status).toBe(401);
  expect(JSON.stringify(invalid.body)).toMatch(
    /invalid_(?:token|widget_session)/,
  );
  expect(guestRefreshes).toBe(0);

  const limitedNetworkResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/v1/agent/error-fixture",
  );
  const limited = await rawWidgetFetch(page, "/v1/agent/error-fixture", {
    token: valid,
  });
  const limitedResponse = await limitedNetworkResponse;
  expect(limited).toMatchObject({
    status: 429,
    body: { error: { code: "fixture_limited" } },
  });
  expect(limited.headers["retry-after"]).toBe("7");
  expect(limited.headers["x-request-id"]).toBe("fixture-error-request");
  expect(limitedResponse.headers()["access-control-allow-origin"]).toBe(
    consumerOrigin,
  );
});

test("rejected widget origins receive a readable 403 without credentials", async ({
  page,
}) => {
  await page.goto(rejectedOrigin, { waitUntil: "domcontentloaded" });
  const rejectedNetworkResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/guest",
  );
  const result = await page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return {
      status: response.status,
      body: await response.json(),
      allowCredentials: response.headers.get(
        "access-control-allow-credentials",
      ),
    };
  }, `${portalOrigin}/api/auth/guest`);
  const rejectedResponse = await rejectedNetworkResponse;
  expect(result).toEqual({
    status: 403,
    body: { error: "invalid_widget_origin" },
    allowCredentials: null,
  });
  expect(rejectedResponse.headers()["access-control-allow-origin"]).toBe("*");
});

test("anonymous widget renews an expired session after the first 401", async ({
  page,
}) => {
  await page.goto(consumerOrigin, { waitUntil: "domcontentloaded" });
  // The edge learns a widget session's lifetime when it first describes it to
  // the Portal and trusts that answer until then, so the session must be short
  // before its first use: end it three seconds in, right before the first chat.
  const sessionSeconds = 3;
  let endsAt: Promise<number> | undefined;
  await page.route(`${portalOrigin}/v1/agent/chat`, async (route) => {
    endsAt ??= shortenWidgetSessions(sessionSeconds);
    await endsAt;
    await route.continue();
  });
  const guest = waitForWidgetSession(page, "/api/auth/guest");
  await sendPrompt(page, "establish anonymous widget session");
  const first = await guest;
  await page.unroute(`${portalOrigin}/v1/agent/chat`);
  expect(endsAt).toBeDefined();
  await page.waitForTimeout(Math.max(0, (await endsAt!) + 1000 - Date.now()));
  const statuses: number[] = [];
  const renewed = waitForWidgetSession(page, "/api/auth/guest");
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/v1/agent/chat") {
      statuses.push(response.status());
    }
  });
  await sendPrompt(page, "renew the anonymous widget session");
  const second = await renewed;
  expect(second.session.access_token).not.toBe(first.session.access_token);
  expect(statuses).toContain(401);
  expect(statuses.at(-1)).toBe(200);
});

test("wallet-authenticated packaged widget persists its WST and canonical user", async ({
  page,
}) => {
  const { wallet, verified } = await signInThroughUi(page, {
    family: "evm",
    pageOrigin: consumerOrigin,
    challengeOrigin: portalOrigin,
    privateKeys: [keys.evm[0]!],
  });
  expect(verified?.status()).toBe(200);
  const session = (await verified!.json()) as WidgetSession;
  const account = await widgetJson<AccountSnapshot>(
    page,
    session.access_token,
    "/v1/account",
  );
  expect(account).toMatchObject({
    user: { id: session.user.id },
    session: { carrier: "widget", authMethod: "siwe" },
  });
  expect(account.guest).not.toBe(true);
  expect(
    account.wallets?.some(
      (entry) =>
        entry.family === "evm" &&
        entry.address?.toLowerCase() === wallet.address.toLowerCase(),
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Check MetaMask" })).toBeHidden(
    { timeout: 30_000 },
  );
  await sendPrompt(page, "wallet widget production contract");
  const chat = (await upstreamRecords()).find(
    (record) => record.method === "POST" && record.path === "/v1/agent/chat",
  );
  expectVerifiedBffRecord(chat, session.user.id, "widget");
  expect(chat?.principal?.principal_class).toBe("user");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toBeVisible({
    timeout: 30_000,
  });
  expect(wallet.signatureCount).toBe(1);
  expect(
    sessionStorageTokenCount(
      await page.evaluate(() => ({ ...sessionStorage })),
    ),
  ).toBe(1);
});

test("widget challenge is origin-bound and single-use", async ({ page }) => {
  const signer = privateKeyToAccount(keys.evm[1]! as `0x${string}`);
  await page.goto(consumerOrigin, { waitUntil: "domcontentloaded" });
  const challenge = await jsonFromPage<{
    nonce: string;
    domain: string;
    uri: string;
    issued_at: string;
    expiration_time: string;
  }>(page, `${portalOrigin}/api/auth/widget/siwe/nonce`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet_address: signer.address, chain_id: 84532 }),
  });
  const message = createSiweMessage({
    address: signer.address,
    chainId: 84532,
    domain: challenge.domain,
    uri: challenge.uri,
    version: "1",
    nonce: challenge.nonce,
    issuedAt: new Date(challenge.issued_at),
    expirationTime: new Date(challenge.expiration_time),
    statement: "Sign in to Aomi.",
  });
  const signature = await signer.signMessage({ message });
  const body = {
    message,
    signature,
    wallet_address: signer.address,
    chain_id: 84532,
  };
  const first = await rawWidgetFetch(page, "/api/auth/widget/siwe/verify", {
    method: "POST",
    body,
  });
  expect(first.status).toBe(200);
  const replay = await rawWidgetFetch(page, "/api/auth/widget/siwe/verify", {
    method: "POST",
    body,
  });
  expect(replay).toMatchObject({
    status: 401,
    body: { error: "invalid_or_expired_nonce" },
  });

  await page.goto(rejectedOrigin, { waitUntil: "domcontentloaded" });
  const wrongOriginNetworkResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/widget/siwe/nonce",
  );
  const wrongOrigin = await rawWidgetFetch(
    page,
    "/api/auth/widget/siwe/nonce",
    {
      method: "POST",
      body: { wallet_address: signer.address, chain_id: 84532 },
    },
  );
  expect(wrongOrigin).toMatchObject({
    status: 403,
    body: { error: "invalid_widget_origin" },
  });
  expect(
    (await wrongOriginNetworkResponse).headers()["access-control-allow-origin"],
  ).toBe("*");
});

/** Every live widget session now ends `seconds` from now; resolves to that time. */
async function shortenWidgetSessions(seconds: number): Promise<number> {
  const pool = new Pool({
    connectionString: process.env.AOMI_TEST_DATABASE_URL,
  });
  try {
    // Both the row's lifetime, which ends the session, and the ticket's own
    // `expiresAt`, which the Portal reports to the edge.
    const shortened = await pool.query(
      `update ba_verifications
          set expires_at = now() + interval '${seconds} seconds',
              value = jsonb_set(
                value::jsonb,
                '{expiresAt}',
                to_jsonb(to_char(
                  (now() + interval '${seconds} seconds') at time zone 'UTC',
                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                ))
              )::text
        where identifier like 'aomi:widget:session:%'`,
    );
    expect(shortened.rowCount).toBeGreaterThan(0);
    return Date.now() + seconds * 1000;
  } finally {
    await pool.end();
  }
}

async function waitForWidgetSession(page: Page, path: string) {
  const response = await page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === path &&
      candidate.status() === 200,
    { timeout: 30_000 },
  );
  return { response, session: (await response.json()) as WidgetSession };
}

async function widgetJson<T = unknown>(
  page: Page,
  token: string,
  path: string,
): Promise<T> {
  const result = await rawWidgetFetch(page, path, { token });
  if (result.status !== 200) {
    throw new Error(`${path} returned HTTP ${result.status}`);
  }
  return result.body as T;
}

async function rawWidgetFetch(
  page: Page,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {},
) {
  return page.evaluate(
    async ({ endpoint, request }) => {
      const headers = new Headers();
      if (request.token)
        headers.set("authorization", `Bearer ${request.token}`);
      if (request.body !== undefined)
        headers.set("content-type", "application/json");
      const response = await fetch(endpoint, {
        method: request.method ?? "GET",
        headers,
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return {
        status: response.status,
        body: await response.json().catch(() => null),
        headers: Object.fromEntries(response.headers.entries()),
      };
    },
    { endpoint: `${portalOrigin}${path}`, request: options },
  );
}

function sessionStorageTokenCount(storage: Record<string, string>): number {
  return Object.keys(storage).filter((key) =>
    key.startsWith("aomi:widget-session:"),
  ).length;
}
