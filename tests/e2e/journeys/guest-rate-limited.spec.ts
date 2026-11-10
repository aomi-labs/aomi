import { test, expect } from "../journey-fixture";

test("a rate-limited send ends the pending state and keeps its draft and refusal", async ({
  widget,
}) => {
  const page = widget.page;
  await page.route("**/v1/agent/chat", (route) =>
    route.fulfill({
      status: 429,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: { code: "rate_limited", message: "Too many requests" },
      }),
    }),
  );
  await widget.input.fill("send limited draft");
  await widget.send.click();
  await expect(
    page.getByText("Too many requests", { exact: true }),
  ).toBeVisible();
  await expect(widget.input).toHaveText("send limited draft");
  await expect(widget.userMessages).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop generating", exact: true }),
  ).toHaveCount(0);
  await page.waitForTimeout(7_000);
  await expect(
    page.getByText(/Your message was not sent because of rate limiting/),
  ).toBeVisible();
  await widget.send.click();
  await expect(widget.input).toHaveText("send limited draft");
  await expect(
    page.getByText("Too many requests", { exact: true }),
  ).toHaveCount(1);
  await page.unroute("**/v1/agent/chat");
  await widget.send.click();
  await expect(widget.replies).toContainText("Fake reply: send limited draft");
  await expect(
    page.getByText("Too many requests", { exact: true }),
  ).toHaveCount(0);
});

test("a rate-limited guest sign-in shows why the message was not sent and keeps the draft", async ({
  widget,
  agent,
}) => {
  const page = widget.page;
  // Answer every guest sign-in with the limiter's real refusal, without
  // exhausting the real limiter.
  await page.route("**/api/auth/guest", (route) =>
    route.fulfill({
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "30" },
      body: JSON.stringify({
        code: "guest_rate_limited",
        message: "Too many guest sessions",
      }),
    }),
  );
  await page.context().clearCookies();
  await page.reload();
  await widget.ready();

  const mark = agent.mark();
  await widget.input.fill("rate limited draft");
  await widget.send.click();

  await expect(page.getByText("Too many requests")).toBeVisible();
  // Toasts close after 6 s; this one must outlast that, because nothing else
  // on the page says the message was not sent.
  await page.waitForTimeout(7_000);
  await expect(page.getByText("Too many requests")).toBeVisible();
  await expect(
    page.getByText(/Too many guest sessions were started from your network/),
  ).toBeVisible();
  await expect(widget.input).toHaveText("rate limited draft");
  await expect(widget.userMessages).toHaveCount(0);
  await expect(widget.input).toBeEditable();
  expect(
    agent.requestsSince(mark).filter((r) => r.route === "chat.start"),
  ).toEqual([]);
});
