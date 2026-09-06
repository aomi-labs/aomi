import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  AomiClient,
  type Event,
  type EventPage,
  type StartTurnIntent,
} from "../../packages/client/src/index.ts";

const byokKey = process.env.AOMI_E2E_BYOK_KEY?.trim();
const byokProvider = process.env.AOMI_E2E_BYOK_PROVIDER?.trim() || "anthropic";
const model = process.env.AOMI_E2E_MODEL?.trim();
const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";

test.describe.configure({ mode: "serial", timeout: 8 * 60_000 });
test.use({ trace: "off", video: "off" });

test("paired account, credits, and platform chat idempotency", async ({
  page,
  context,
}) => {
  await signInWithTestWallet(page);

  const fundingHeaders: string[] = [];
  const client = await authenticatedClient(context, fundingHeaders);

  const keysBefore = await client.listByokKeys("account-e2e");
  expect(Array.isArray(keysBefore)).toBe(true);

  const credits = await client.account.credits.get({ limit: 10 });
  expect(Number.isSafeInteger(credits.included.remaining_microusd)).toBe(true);
  expect(Number.isSafeInteger(credits.bank.balance_microusd)).toBe(true);

  const platformSession = `lean-payment-platform-${randomUUID()}`;
  const platformIntent: StartTurnIntent = {
    sessionId: platformSession,
    message: "Reply with exactly LEAN_PAYMENT_E2E_OK.",
    ...(model ? { model } : {}),
  };
  const platformKey = `lean-payment-platform-${randomUUID()}`;
  const platformPages = await settleTurn(
    client,
    platformSession,
    platformIntent,
    platformKey,
  );
  expect(agentReply(platformPages)).toContain("LEAN_PAYMENT_E2E_OK");

  const replay = await client.agent.start(platformIntent, {
    idempotencyKey: platformKey,
  });
  expect(replay.session_id).toBe(platformSession);
  const originalSequences = new Set(
    platformPages.flatMap((entry) =>
      entry.events.map((event) => event.sequence),
    ),
  );
  expect(
    replay.events.every((event) => originalSequences.has(event.sequence)),
  ).toBe(true);

  const followUpSession = `lean-payment-follow-up-${randomUUID()}`;
  const followUpIntent: StartTurnIntent = {
    sessionId: followUpSession,
    message: "Reply with exactly LEAN_PAYMENT_FOLLOW_UP_OK.",
    ...(model ? { model } : {}),
  };
  const followUpPages = await settleTurn(
    client,
    followUpSession,
    followUpIntent,
    `lean-payment-follow-up-${randomUUID()}`,
  );
  expect(agentReply(followUpPages)).toContain("LEAN_PAYMENT_FOLLOW_UP_OK");
});

test("paired model-key CRUD and explicit user_byok chat", async ({
  page,
  context,
}) => {
  test.skip(!byokKey, "AOMI_E2E_BYOK_KEY is required for the BYOK flow");
  if (!byokKey) return;
  await signInWithTestWallet(page);

  const fundingHeaders: string[] = [];
  const client = await authenticatedClient(context, fundingHeaders);

  const saved = await client.saveByokKey(
    "account-e2e",
    byokProvider,
    byokKey,
    "lean-payment-boundary-e2e",
  );
  try {
    expect(saved.provider).toBe(byokProvider);
    expect(saved.key_prefix).toBeTruthy();

    const listed = await client.listByokKeys("account-e2e");
    expect(listed.some((entry) => entry.provider === byokProvider)).toBe(true);

    const byokSession = `lean-payment-byok-${randomUUID()}`;
    const byokIntent: StartTurnIntent = {
      sessionId: byokSession,
      message: "Reply with exactly LEAN_PAYMENT_BYOK_E2E_OK.",
      ...(model ? { model } : {}),
    };
    const byokPages = await settleTurn(
      client,
      byokSession,
      byokIntent,
      `lean-payment-byok-${randomUUID()}`,
      "user_byok",
    );
    expect(agentReply(byokPages)).toContain("LEAN_PAYMENT_BYOK_E2E_OK");
    expect(fundingHeaders).toContain("user_byok");
  } finally {
    await client.deleteByokKey("account-e2e", byokProvider);
  }

  const keysAfter = await client.listByokKeys("account-e2e");
  expect(keysAfter.some((entry) => entry.provider === byokProvider)).toBe(
    false,
  );
});

async function signInWithTestWallet(page: Page): Promise<void> {
  page.setDefaultTimeout(30_000);
  const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
  if (walletToken) {
    const seed = new URL("/api/bff/e2e/wallet", portalOrigin);
    seed.searchParams.set("token", walletToken);
    seed.searchParams.set(
      "address",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    );
    seed.searchParams.set("chainId", "31337");
    const response = await page.request.get(seed.toString(), {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(307);
  }
  const hydrated = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/account",
    { timeout: 60_000 },
  );
  await page.goto("/dev/widget-auth-e2e", { waitUntil: "domcontentloaded" });
  expect((await hydrated).ok()).toBe(true);
  const verified = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/siwe/verify" &&
      response.request().method() === "POST",
  );
  const reloaded = page.waitForEvent("framenavigated", {
    predicate: (frame) => frame === page.mainFrame(),
  });
  await page.getByRole("button", { name: "Test SIWE Sign In" }).click();
  expect((await verified).status()).toBe(200);
  await reloaded;
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/get-session", {
            credentials: "include",
          });
          return response.json();
        }),
      { timeout: 30_000 },
    )
    .toMatchObject({ user: { isAnonymous: false } });
}

async function authenticatedClient(
  context: BrowserContext,
  fundingHeaders: string[],
): Promise<AomiClient> {
  const cookieHeader = (await context.cookies())
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");

  return new AomiClient({
    baseUrl: portalOrigin,
    guest: false,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Cookie", cookieHeader);
      headers.set("Origin", portalOrigin);
      const funding = headers.get("x-aomi-inference-funding");
      if (funding) fundingHeaders.push(funding);
      const response = await fetch(input, { ...init, headers });
      if (!response.ok) {
        const body = await response
          .clone()
          .json()
          .catch(() => ({}));
        throw new Error(
          `${new URL(String(input)).pathname}: HTTP ${response.status} ${body.code ?? body.error?.code ?? body.error?.message ?? body.error ?? ""}`,
        );
      }
      return response;
    },
  });
}

async function settleTurn(
  client: AomiClient,
  sessionId: string,
  intent: StartTurnIntent,
  idempotencyKey: string,
  inferenceFunding?: "user_byok",
): Promise<EventPage[]> {
  const pages: EventPage[] = [];
  let page = await client.agent.start(intent, {
    idempotencyKey,
    ...(inferenceFunding ? { inferenceFunding } : {}),
  });
  pages.push(page);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (terminalState(pages) !== undefined) return pages;
    page = await client.agent.poll(sessionId, {
      cursor: page.cursor,
      waitMs: 15_000,
    });
    pages.push(page);
  }

  throw new Error(`Agent turn ${sessionId} did not settle within 3 minutes`);
}

function terminalState(pages: EventPage[]): string | undefined {
  return pages
    .flatMap((page) => page.events)
    .filter((event) => event.type === "turn_state_changed")
    .map((event) => event.state)
    .findLast((state) => ["complete", "failed", "interrupted"].includes(state));
}

function agentReply(pages: EventPage[]): string {
  return pages
    .flatMap((page) => page.events)
    .filter(
      (event): event is Extract<Event, { type: "message" }> =>
        event.type === "message" && event.sender === "agent",
    )
    .map((event) => event.content)
    .join("\n");
}

test("local Portal root chat settles and settings renders", async ({
  page,
}) => {
  test.skip(
    !process.env.AOMI_E2E_WALLET_TOKEN,
    "AOMI_E2E_WALLET_TOKEN is required for the local Portal smoke",
  );
  await signInWithTestWallet(page);

  await page.context().clearCookies({ name: "aomi_e2e_wallet" });
  const selectedModel = model || "gpt-5.6-luna";
  const agentPages: EventPage[] = [];
  const responseTasks: Promise<void>[] = [];
  const agentStatuses: number[] = [];
  await page.route("**/v1/agent/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as Record<
      string,
      unknown
    >;
    body.model = selectedModel;
    await route.continue({ postData: JSON.stringify(body) });
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith("/v1/agent/chat")) return;
    agentStatuses.push(response.status());
    if (response.status() === 200) {
      responseTasks.push(
        response
          .json()
          .then((body: EventPage) => agentPages.push(body))
          .catch(() => undefined),
      );
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  const input = page.getByRole("textbox", { name: "Message input" });
  await expect(input).toBeVisible();
  await input.fill("Reply with exactly LEAN_PAYMENT_PORTAL_UI_OK.");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect.poll(() => agentStatuses, { timeout: 30_000 }).toContain(200);
  await expect
    .poll(
      async () => {
        await Promise.all(responseTasks);
        return agentPages
          .flatMap((entry) => entry.events)
          .some(
            (event) =>
              event.type === "message" &&
              event.sender === "agent" &&
              event.content.includes("LEAN_PAYMENT_PORTAL_UI_OK"),
          );
      },
      { timeout: 180_000 },
    )
    .toBe(true);

  await expect
    .poll(
      () =>
        agentPages
          .flatMap((entry) => entry.events)
          .some(
            (event) =>
              event.type === "turn_state_changed" && event.state === "complete",
          ),
      { timeout: 30_000 },
    )
    .toBe(true);

  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(
    page.getByRole("button", { name: "Close settings" }),
  ).toBeVisible();
  await expect(
    page.getByText("Settings", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "General", exact: true }),
  ).toBeVisible();
});
