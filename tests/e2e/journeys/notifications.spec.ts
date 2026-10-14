import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("a durable notice reload respects guest ownership without replaying its turn", async ({
  widget,
  agent,
  guestOwner,
}) => {
  await widget.sendAndSettle("[notify] settlement");
  const notice = widget.page
    .getByTestId(testIds.notice)
    .filter({ hasText: "Fake notification: your transfer settled." });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(1);
  expect(agent.starts()).toHaveLength(1);
  const sessionId = agent.sessions()[0]!.id;
  const durableEvents = agent.events(sessionId);
  await widget.page.reload();
  await widget.ready();
  await widget.input.focus();
  await guestOwner.assertOwnerAfterReload();
  if (guestOwner.kind === "cookie") {
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(1);
  } else {
    await expect(notice).toHaveCount(0);
    await expect(widget.replies).toHaveCount(0);
    await expect(widget.rows).toHaveCount(0);
    await expect(widget.input).toBeEmpty();
  }
  expect(agent.events(sessionId)).toEqual(durableEvents);
  expect(agent.starts()).toHaveLength(1);
});
