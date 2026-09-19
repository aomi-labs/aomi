import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  expect,
  test,
  type Page,
  type Response,
  type Locator,
} from "@playwright/test";

const portalOrigin = process.env.LOCAL_PORTAL_URL ?? "http://127.0.0.1:3000";
const anvilOrigin = process.env.LOCAL_ANVIL_URL ?? "http://127.0.0.1:8545";
const walletToken = process.env.AOMI_E2E_WALLET_TOKEN;
const walletAddress = process.env.AOMI_E2E_WALLET_ADDRESS;
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
  if (!walletAddress)
    throw new Error(
      "E2E wallet address must match the configured executor signer",
    );
  await mkdir(artifactDir, { recursive: true });

  const requests: Array<{ method: string; url: string; status?: number }> = [];
  const pages: ObservedEvent[] = [];
  const responseTasks: Promise<void>[] = [];
  let executionRequests = 0;
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
    executionRequests += 1;
    markExecutionIntercepted();
    await executionReleased;
    await route.continue();
  });

  const seed = new URL("/api/bff/e2e/wallet", portalOrigin);
  seed.searchParams.set("token", walletToken!);
  seed.searchParams.set("address", walletAddress!);
  seed.searchParams.set("chainId", "31337");
  seed.searchParams.set("redirect", "/");
  await page.goto(seed.toString(), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("portal-shell")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");
  const declineCookies = page.getByRole("button", {
    name: "Decline",
    exact: true,
  });
  await expect(declineCookies).toBeVisible({ timeout: 30_000 });
  await declineCookies.click();
  await expect(declineCookies).toHaveCount(0);

  const firstPrompt =
    `CUTOVER A: send 0 ETH on chain 31337 to ${recipient}. ` +
    "Prepare and simulate it, then call commit_txs in this same turn so the runtime emits an Action. " +
    "Do not ask me for another chat message.";
  const sessionsBeforeA = new Set(pages.map((entry) => entry.session_id));
  await send(page, firstPrompt);

  const sidebar = page.getByRole("complementary", { name: "Chat activity" });
  const review = sidebar.getByTestId("transaction-review");
  await expect(review).toBeVisible({ timeout: 300_000 });
  // The sidebar is the only approval surface.
  await expect(page.getByTestId("transaction-review")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Send to wallet", exact: true }),
  ).toHaveCount(1);
  const transactionDetails = review.locator("details").filter({
    has: page.locator("summary", { hasText: "Transaction details" }),
  });
  await transactionDetails.locator("summary").click();
  await expect(transactionDetails.locator("pre")).toContainText(recipient);
  const simulationDetails = review.locator("details").filter({
    has: page.locator("summary", { hasText: "Simulation details" }),
  });
  await simulationDetails.locator("summary").click();
  await expect(simulationDetails.locator("pre")).toBeVisible();
  await expect(simulationDetails.locator("pre")).toContainText(
    '"status": "passed"',
  );
  await expect
    .poll(() => actionSessionId(pages, sessionsBeforeA), { timeout: 180_000 })
    .toBeTruthy();
  const sessionA = actionSessionId(pages, sessionsBeforeA);
  if (!sessionA) throw new Error("first Agent Action session was not observed");
  expect(lifecycle(pages, sessionA)).toContain("awaiting_action");
  await page.waitForTimeout(1_200);
  expect(executionRequests).toBe(0);
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
  await review
    .getByRole("button", { name: "Send to wallet", exact: true })
    .click();
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
    .toBe("complete");
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

  expect(executionRequests).toBe(1);
  await expect(page.getByTestId("transaction-review")).toHaveCount(0);
  await showTransactionHistory(page);
  const signed = sidebar.locator('[aria-label$="signing: signed"]');
  await expect(signed.first()).toBeVisible();
  const transactionCount = await sidebar
    .getByTestId("activity-transaction")
    .count();

  const threadA = await threadRow(page, sessionA);
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
    .toBe("complete");
  const threadB = await threadRow(page, sessionB);

  const cursorlessARequestsBefore = cursorlessPolls(requests, sessionA);
  await switchToThread(threadA);
  await expect(page.getByText(/CUTOVER A:/)).toBeVisible({ timeout: 30_000 });
  await switchToThread(threadB);
  await expect(page.getByText(/CUTOVER B:/)).toBeVisible({ timeout: 30_000 });
  await switchToThread(threadA);
  await expect(page.getByText(/CUTOVER A:/)).toBeVisible({ timeout: 30_000 });
  expect(cursorlessPolls(requests, sessionA)).toBe(cursorlessARequestsBefore);
  assertOrderedAndDeduplicated(pages, sessionA);

  await showTransactionHistory(page);
  await expect(sidebar.getByTestId("activity-transaction")).toHaveCount(
    transactionCount,
  );
  await expect(signed.first()).toBeVisible();
  await expect(page.getByTestId("transaction-review")).toHaveCount(0);
  expect(executionRequests).toBe(1);

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
  await expect(input).toHaveAttribute("contenteditable", "true");
  await input.pressSequentially(message);
  await expect(input).toHaveText(message);
  await expect(submit).toBeEnabled();
  await submit.click();
}

async function showTransactionHistory(page: Page) {
  const open = page.getByRole("button", {
    name: "Show chat activity",
    exact: true,
  });
  if (await open.isVisible()) await open.click();
  const sidebar = page.getByRole("complementary", { name: "Chat activity" });
  await expect(sidebar).toBeVisible();
  const transactions = sidebar.getByRole("button", { name: /^Transactions/ });
  if ((await transactions.getAttribute("aria-expanded")) === "false") {
    await transactions.click();
  }
  await expect(
    sidebar.getByTestId("activity-transaction").first(),
  ).toBeVisible();
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

async function threadRow(page: Page, sessionId: string): Promise<Locator> {
  const row = page.locator(
    `.aui-thread-list-item[data-thread-id="${sessionId}"]`,
  );
  await expect(row).toHaveCount(1);
  return row;
}

async function switchToThread(row: Locator): Promise<void> {
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
