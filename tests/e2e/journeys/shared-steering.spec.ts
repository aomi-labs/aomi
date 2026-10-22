import { test, expect } from "../journey-fixture";

test("ordinary follow-ups stay in the conversation between working traces", async ({
  widget,
  agent,
}) => {
  agent.enableTurnInput();
  await widget.submit("[slow] research token");
  await expect(widget.stop).toBeVisible();
  await widget.input.fill("Use 5 on Base");
  await widget.send.click();
  await expect.poll(() => agent.requestsSince(0, "chat.steer").length).toBe(1);
  expect(agent.starts()).toHaveLength(1);
  await expect(widget.replies).toHaveCount(2);
  await expect
    .poll(() =>
      widget.page
        .locator(
          '[data-testid="aomi-user-message"],[data-testid="aomi-assistant-message"]',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-testid")),
        ),
    )
    .toEqual([
      "aomi-user-message",
      "aomi-assistant-message",
      "aomi-user-message",
      "aomi-assistant-message",
    ]);
  await expect(
    widget.page.getByRole("button", { name: /Queue new|Update current/ }),
  ).toHaveCount(0);
  const session = agent.starts()[0].sessionId!;
  agent.applySteering(session);
  agent.completeActiveInput(session, "Research with 5 on Base");
  await expect(
    widget.replies.filter({ hasText: "Research with 5 on Base" }),
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
  await widget.send.click();
  await expect(widget.input).toHaveText("Keep this correction");
  await expect(
    widget.page.getByRole("button", { name: /Queue new|Update current/ }),
  ).toHaveCount(0);
  expect(agent.starts()).toHaveLength(1);
  await widget.send.click();
  await expect(
    widget.replies.filter({ hasText: "Fake reply: Keep this correction" }),
  ).toBeVisible();
  expect(agent.starts()).toHaveLength(2);
});
