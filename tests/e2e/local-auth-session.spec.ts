import { expect, test, type Page, type Response } from "@playwright/test";

type BetterAuthSession = {
  user?: {
    id?: string;
    isAnonymous?: boolean;
  };
};

type Account = { user?: { id?: string } };
type EventPage = {
  events?: Array<{ type?: string; sender?: string; content?: string }>;
};

test("first Agent turn preserves the signed-in Better Auth session", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  const anonymousSignIns: Response[] = [];
  const agentStatuses: number[] = [];
  const eventPages: EventPage[] = [];
  const responseTasks: Promise<void>[] = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (
      path === "/api/auth/sign-in/anonymous" &&
      response.request().method() === "POST"
    ) {
      anonymousSignIns.push(response);
    }
    if (path.startsWith("/v1/agent/chat")) {
      agentStatuses.push(response.status());
      if (response.status() === 200) {
        responseTasks.push(
          response
            .json()
            .then((body: EventPage) => eventPages.push(body))
            .catch(() => undefined),
        );
      }
    }
  });

  await page.goto("/dev/widget-auth-e2e", {
    waitUntil: "domcontentloaded",
  });
  const verified = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/siwe/verify" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Test SIWE Sign In" }).click();
  await expect((await verified).status()).toBe(200);

  await expect
    .poll(() => session(page), { timeout: 30_000 })
    .toMatchObject({ user: { isAnonymous: false } });
  const beforeSession = await session(page);
  const beforeAccount = await account(page);
  expect(beforeSession.user?.id).toBeTruthy();
  expect(beforeAccount.user?.id).toBeTruthy();

  const replacement = await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: "{}",
    });
    return {
      status: response.status,
      body: (await response.json()) as { code?: string },
    };
  });
  expect(replacement).toEqual({
    status: 409,
    body: { code: "session_exists" },
  });
  expect((await session(page)).user?.id).toBe(beforeSession.user?.id);
  const anonymousAttemptsBeforeAgent = anonymousSignIns.length;

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const input = page.getByRole("textbox", { name: "Message input" });
  await input.fill("hello");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect.poll(() => agentStatuses, { timeout: 30_000 }).toContain(200);
  await expect(page.getByText("hello", { exact: true })).toBeVisible();
  await expect
    .poll(
      async () => {
        await Promise.all(responseTasks);
        return eventPages
          .flatMap((entry) => entry.events ?? [])
          .some(
            (event) =>
              event.type === "message" &&
              event.sender === "agent" &&
              Boolean(event.content?.trim()),
          );
      },
      { timeout: 150_000 },
    )
    .toBe(true);
  await expect
    .poll(async () => (await session(page)).user?.id, { timeout: 150_000 })
    .toBe(beforeSession.user?.id);
  const after = await session(page);
  const afterAccount = await account(page);
  expect(after.user?.isAnonymous).toBe(false);
  expect(afterAccount.user?.id).toBe(beforeAccount.user?.id);
  expect(anonymousSignIns).toHaveLength(anonymousAttemptsBeforeAgent);
});

async function session(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session", {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`get-session failed with HTTP ${response.status}`);
    }
    return (await response.json()) as BetterAuthSession;
  });
}

async function account(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/v1/account", { credentials: "include" });
    if (!response.ok) {
      throw new Error(`account failed with HTTP ${response.status}`);
    }
    return (await response.json()) as Account;
  });
}
