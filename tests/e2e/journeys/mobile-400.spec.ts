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
  const sheet = widget.page.getByTestId(testIds.mobileSheet);
  await widget.openSidebar();
  await expect(sheet).toBeVisible();
  // Tap the row itself: picking a chat must close the sheet on its own, so
  // this skips the helper that would press Escape.
  await widget.rows
    .filter({ hasText: "Title: mobile A" })
    .getByRole("button")
    .first()
    .click();
  await expect(sheet).toBeHidden();
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

test("400px New chat closes the sidebar and opens an empty chat", async ({
  widget,
}) => {
  await widget.page.setViewportSize({ width: 400, height: 844 });
  await widget.sendAndSettle("mobile new chat");
  const sheet = widget.page.getByTestId(testIds.mobileSheet);
  await widget.openSidebar();
  await expect(sheet).toBeVisible();
  await sheet.getByTestId(testIds.newChat).click();
  await expect(sheet).toBeHidden();
  await expect(widget.input).toBeVisible();
  await expect(
    widget.replies.filter({ hasText: "Fake reply: mobile new chat" }),
  ).toBeHidden();
});
