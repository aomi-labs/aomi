import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("400px sidebar opens, selects a chat and closes without overflow or losing drafts", async ({
  widget,
  agent,
}) => {
  await widget.page.setViewportSize({ width: 400, height: 844 });
  await widget.sendAndSettle("mobile A");
  await widget.input.fill("unfinished mobile A");
  await widget.newChat();
  await widget.sendAndSettle("mobile B");
  const mark = agent.mark();
  await widget.openSidebar();
  await expect(widget.page.getByTestId(testIds.mobileSheet)).toBeVisible();
  await widget.select("Title: mobile A");
  await expect(widget.page.getByTestId(testIds.mobileSheet)).toBeHidden();
  await expect(widget.input).toHaveText("unfinished mobile A");
  await expect(
    widget.replies.filter({ hasText: "Fake reply: mobile A" }),
  ).toBeVisible();
  expect(
    await widget.page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    agent
      .requestsSince(mark)
      .filter((request) =>
        ["chat.poll", "sessions.get"].includes(request.route),
      ),
  ).toEqual([]);
});
