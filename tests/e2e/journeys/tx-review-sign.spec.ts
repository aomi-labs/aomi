import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("transaction review waits for consent and reload respects guest ownership without replay", async ({
  widget,
  agent,
  guestOwner,
}) => {
  await widget.submit("[tx] transfer");
  await expect(
    widget.replies.filter({ hasText: "Review the simulated transfer" }),
  ).toBeVisible();
  const review = widget.page.getByTestId(testIds.txReview);
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Reject", exact: true }),
  ).toBeEnabled();
  expect(
    agent.log.filter((request) => request.route === "chat.action"),
  ).toHaveLength(0);
  await review.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(
    widget.replies.filter({ hasText: "Fake: transfer rejected." }),
  ).toBeVisible();
  expect(
    agent.log.filter((request) => request.route === "chat.action"),
  ).toHaveLength(1);
  const sessionId = agent.sessions()[0]!.id;
  const durableEvents = agent.events(sessionId);
  await widget.page.reload();
  await widget.ready();
  await widget.input.focus();
  await guestOwner.assertOwnerAfterReload();
  await expect(
    widget.replies.filter({ hasText: "Fake: transfer rejected." }),
  ).toHaveCount(guestOwner.kind === "cookie" ? 1 : 0);
  if (guestOwner.kind === "widget-memory") {
    await expect(widget.replies).toHaveCount(0);
    await expect(widget.rows).toHaveCount(0);
    await expect(widget.input).toBeEmpty();
  }
  await expect(
    widget.page.getByRole("button", { name: "Reject", exact: true }),
  ).toHaveCount(0);
  expect(
    agent.log.filter((request) => request.route === "chat.action"),
  ).toHaveLength(1);
  expect(agent.starts()).toHaveLength(1);
  expect(agent.events(sessionId)).toEqual(durableEvents);
});
