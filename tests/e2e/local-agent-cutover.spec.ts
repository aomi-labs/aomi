import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page, type Response } from "@playwright/test";

const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";
const anvilOrigin = process.env.LOCAL_ANVIL_URL ?? "http://127.0.0.1:8545";
const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
const walletAddress =
  process.env.AOMI_E2E_WALLET_ADDRESS ??
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const artifactDir = join(
  process.cwd(),
  "output/playwright/local-agent-cutover",
);

type ObservedEvent = {
  session_id: string;
  cursor: string;
  events: Array<{
    type: string;
    sequence: number;
    state?: string;
    id?: string;
    request?: unknown;
  }>;
};

test.describe.configure({ mode: "serial", timeout: 10 * 60_000 });

test("local Agent Action executes and session snapshots survive A to B to A", async ({
  page,
  request,
}) => {
  test.skip(!walletToken, "AOMI_E2E_WALLET_TOKEN is required");
  await mkdir(artifactDir, { recursive: true });

  const requests: Array<{ method: string; url: string; status?: number }> = [];
  const pages: ObservedEvent[] = [];
  const responseTasks: Promise<void>[] = [];
  let executionRequested = false;
  page.on("request", (entry) => {
    requests.push({ method: entry.method(), url: redactUrl(entry.url()) });
  });
  page.on("response", (response) => {
    const responseUrl = redactUrl(response.url());
    const record = [...requests]
      .reverse()
      .find((entry) => entry.url === responseUrl && entry.status === undefined);
    if (record) record.status = response.status();
    if (isAgentEventResponse(response)) {
      responseTasks.push(
        response
          .json()
          .then((body: ObservedEvent) => pages.push(body))
          .catch(() => undefined),
      );
    }
  });

  let releaseExecution = () => undefined;
  let markExecutionIntercepted = () => undefined;
  const executionReleased = new Promise<void>((resolve) => {
    releaseExecution = resolve;
  });
  const executionIntercepted = new Promise<void>((resolve) => {
    markExecutionIntercepted = resolve;
  });
  await page.route("**/api/bff/e2e/execute", async (route) => {
    executionRequested = true;
    markExecutionIntercepted();
    await executionReleased;
    await route.continue();
  });

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

  const firstPrompt =
    `CUTOVER A: send 0 ETH on chain 31337 to ${recipient}. ` +
    "Prepare and simulate it, then call commit_txs in this same turn so the runtime emits an Action. " +
    "Do not ask me for another chat message.";
  const sessionsBeforeA = new Set(pages.map((entry) => entry.session_id));
  await send(page, firstPrompt);

  await expect(
    page.getByRole("heading", { name: "Review action" }),
  ).toBeVisible({
    timeout: 180_000,
  });
  await expect(page.getByTestId("action-simulation")).toBeVisible();
  await expect(page.getByTestId("action-request-payload")).toContainText(
    recipient,
  );
  await expect
    .poll(() => actionSessionId(pages, sessionsBeforeA), { timeout: 180_000 })
    .toBeTruthy();
  const sessionA = actionSessionId(pages, sessionsBeforeA);
  if (!sessionA) throw new Error("first Agent Action session was not observed");
  expect(lifecycle(pages, sessionA)).toContain("awaiting_action");
  await page.waitForTimeout(1_200);
  expect(executionRequested).toBe(false);
  await page.screenshot({
    path: join(artifactDir, "awaiting-action.png"),
    fullPage: true,
  });

  const executeResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/bff/e2e/execute") &&
      response.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Approve" }).click();
  await executionIntercepted;
  releaseExecution();
  const execution = await executeResponse;
  expect(execution.status()).toBe(200);
  const executionBody = (await execution.json()) as {
    ok: boolean;
    txHash: string;
  };
  expect(executionBody.ok).toBe(true);

  await expect
    .poll(() => terminalState(pages, sessionA), { timeout: 180_000 })
    .toMatch(/complete|failed|interrupted/);
  await Promise.all(responseTasks);
  assertOrderedAndDeduplicated(pages, sessionA);
  expect(lifecycle(pages, sessionA)).toEqual(
    expect.arrayContaining(["processing", "awaiting_action"]),
  );

  const receipt = await request.post(anvilOrigin, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [executionBody.txHash],
    },
  });
  expect(receipt.ok()).toBe(true);
  expect(
    ((await receipt.json()) as { result?: { status?: string } }).result?.status,
  ).toBe("0x1");

  const threadA = await activeThreadTitle(page);
  const sessionsBeforeB = new Set(pages.map((entry) => entry.session_id));
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await send(
    page,
    "CUTOVER B: reply with exactly B_READY and do nothing else.",
  );
  await expect
    .poll(() => newSessionId(pages, sessionsBeforeB), { timeout: 180_000 })
    .toBeTruthy();
  const sessionB = newSessionId(pages, sessionsBeforeB);
  expect(sessionB).toBeTruthy();
  if (!sessionB) throw new Error("second Agent session was not observed");
  await expect
    .poll(() => terminalState(pages, sessionB), { timeout: 180_000 })
    .toMatch(/complete|failed|interrupted/);
  const threadB = await activeThreadTitle(page);

  const cursorlessARequestsBefore = cursorlessPolls(requests, sessionA);
  await switchToThread(page, threadA);
  await expect(page.getByText(/CUTOVER A:/)).toBeVisible({ timeout: 30_000 });
  await switchToThread(page, threadB);
  await expect(page.getByText(/CUTOVER B:/)).toBeVisible({ timeout: 30_000 });
  await switchToThread(page, threadA);
  await expect(page.getByText(/CUTOVER A:/)).toBeVisible({ timeout: 30_000 });
  expect(cursorlessPolls(requests, sessionA)).toBe(cursorlessARequestsBefore);
  assertOrderedAndDeduplicated(pages, sessionA);

  const retired = requests.filter(({ url }) =>
    /\/api\/thread\/(chat|state|interrupt)(?:[/?]|$)/.test(url),
  );
  expect(retired).toEqual([]);
  const remoteAomi = requests.filter(({ url }) =>
    /https:\/\/(?:[^/]+\.)?aomi\.dev\b/.test(url),
  );
  expect(remoteAomi).toEqual([]);

  await page.screenshot({
    path: join(artifactDir, "terminal-session-a.png"),
    fullPage: true,
  });
  await writeFile(
    join(artifactDir, "request-matrix.json"),
    `${JSON.stringify(requests, null, 2)}\n`,
  );
  await writeFile(
    join(artifactDir, "lifecycle-trace.json"),
    `${JSON.stringify(pages, null, 2)}\n`,
  );
  await writeFile(
    join(artifactDir, "identity-capsule.json"),
    `${JSON.stringify(
      {
        wallet: `${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}`,
        chainId: 31337,
        sessions: [sessionA, sessionB],
        transaction: executionBody.txHash,
      },
      null,
      2,
    )}\n`,
  );
});

async function send(page: Page, message: string) {
  const input = page.getByRole("textbox", { name: "Message input" });
  const submit = page.getByRole("button", { name: "Send message" });
  await input.fill(message);
  await expect(input).toHaveValue(message);
  await expect(submit).toBeEnabled();
  await submit.click();
}

function isAgentEventResponse(response: Response): boolean {
  const url = new URL(response.url());
  return (
    response.status() === 200 &&
    url.pathname.startsWith("/v1/agent/chat") &&
    !url.pathname.includes("/actions/")
  );
}

function actionSessionId(
  pages: ObservedEvent[],
  previous: ReadonlySet<string>,
): string | undefined {
  return pages.findLast(
    (entry) =>
      !previous.has(entry.session_id) &&
      entry.events.some((event) => event.type === "action"),
  )?.session_id;
}

function lifecycle(pages: ObservedEvent[], sessionId?: string): string[] {
  return pages
    .filter((page) => !sessionId || page.session_id === sessionId)
    .flatMap((page) => page.events)
    .filter((event) => event.type === "turn_state_changed")
    .map((event) => event.state)
    .filter((state): state is string => Boolean(state));
}

function terminalState(pages: ObservedEvent[], sessionId?: string): string {
  return (
    lifecycle(pages, sessionId).findLast((state) =>
      ["complete", "failed", "interrupted"].includes(state),
    ) ?? "pending"
  );
}

function newSessionId(
  pages: ObservedEvent[],
  previous: ReadonlySet<string>,
): string | undefined {
  return pages.findLast((entry) => !previous.has(entry.session_id))?.session_id;
}

async function activeThreadTitle(page: Page): Promise<string> {
  const active = page.locator(".aui-thread-list-item[data-active]");
  const title = active.locator(".aui-thread-list-item-title");
  await expect(title).not.toHaveText("New Chat", { timeout: 30_000 });
  const value = (await title.textContent())?.trim();
  if (!value) throw new Error("active thread title was not rendered");
  return value;
}

async function switchToThread(page: Page, title: string): Promise<void> {
  const row = page
    .locator(".aui-thread-list-item")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
  await row.locator(".aui-thread-list-item-trigger").click();
  await expect(row).toHaveAttribute("data-active", "true");
}

function assertOrderedAndDeduplicated(
  pages: ObservedEvent[],
  sessionId: string,
) {
  const sequences = pages
    .filter((page) => page.session_id === sessionId)
    .flatMap((page) => page.events.map((event) => event.sequence));
  expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  expect(new Set(sequences).size).toBe(sequences.length);
}

function cursorlessPolls(
  requests: Array<{ method: string; url: string }>,
  sessionId: string,
): number {
  return requests.filter(({ method, url }) => {
    const parsed = new URL(url);
    return (
      method === "GET" &&
      parsed.pathname === `/v1/agent/chat/${sessionId}` &&
      !parsed.searchParams.has("cursor")
    );
  }).length;
}

function redactUrl(value: string): string {
  const url = new URL(value);
  for (const key of ["token", "authorization", "code"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "REDACTED");
  }
  return url.toString();
}
