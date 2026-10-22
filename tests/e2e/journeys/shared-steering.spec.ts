import { test, expect } from "../journey-fixture";

test("ordinary active text updates its request; explicit Queue waits for completion", async ({
  widget,
  agent,
}) => {
  agent.enableTurnInput();
  await widget.submit("[slow] research token");
  await expect(widget.stop).toBeVisible();
  await widget.input.fill("Use 5 on Base");
  await widget.page
    .getByRole("button", { name: "Update current request", exact: true })
    .click();
  await expect(
    widget.page.getByRole("status").filter({ hasText: "Update accepted" }),
  ).toBeVisible();
  expect(agent.requestsSince(0, "chat.steer")).toHaveLength(1);
  expect(agent.starts()).toHaveLength(1);
  await widget.input.fill("Independent research");
  await widget.page
    .getByRole("button", { name: "Queue new request", exact: true })
    .click();
  await expect(
    widget.page.getByText("Queued: Independent research", { exact: true }),
  ).toBeVisible();
  const session = agent.starts()[0].sessionId!;
  agent.applySteering(session);
  await expect(
    widget.page.getByRole("status").filter({ hasText: "Update applied" }),
  ).toBeVisible();
  agent.completeActiveInput(session, "Research with 5 on Base");
  await expect(
    widget.replies.filter({ hasText: "Research with 5 on Base" }),
  ).toBeVisible();
  await expect(
    widget.page.getByText("Queued: Independent research", { exact: true }),
  ).toBeHidden();
  await expect(widget.stop).toBeVisible();
  agent.completeActiveInput(session, "Independent result");
  await expect(
    widget.replies.filter({ hasText: "Independent result" }),
  ).toBeVisible();
  await expect(widget.stop).toBeHidden();
});

test("an update that loses the completion race remains in the composer", async ({
  widget,
  agent,
}) => {
  agent.enableTurnInput();
  await widget.submit("[slow] running");
  await widget.input.fill("Keep this correction");
  agent.finishBeforeNextSteer();
  await widget.page
    .getByRole("button", { name: "Update current request", exact: true })
    .click();
  await expect(widget.input).toHaveText("Keep this correction");
  await expect(
    widget.page.getByRole("status").filter({ hasText: "Update not accepted" }),
  ).toBeVisible();
  expect(agent.starts()).toHaveLength(1);
  await widget.send.click();
  await expect(
    widget.replies.filter({ hasText: "Fake reply: Keep this correction" }),
  ).toBeVisible();
  expect(agent.starts()).toHaveLength(2);
});
