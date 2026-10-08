import { test, expect } from "../journey-fixture";

test("guest replies settle exactly once across consecutive turns", async ({
  widget,
  agent,
}) => {
  await widget.sendAndSettle("first journey");
  await widget.sendAndSettle("second journey");
  expect(agent.starts()).toHaveLength(2);
  await expect(
    widget.replies.filter({ hasText: "Fake reply: first journey" }),
  ).toHaveCount(1);
  expect(agent.log.filter((r) => r.route === "chat.start")).toHaveLength(2);
});
