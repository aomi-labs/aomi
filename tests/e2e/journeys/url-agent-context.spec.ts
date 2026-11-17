import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

// Portal only: an embed takes its agent from props, not from the page URL.
test("a locked URL agent stays selected through a turn, reload, new chat and history", async ({
  widget,
}) => {
  const page = widget.page;
  await page.goto("/?agent=aomi%2Fhoodit&lock_agent=1");
  await widget.ready();
  const indicator = page
    .getByTestId(testIds.composerSelectedAgent)
    .filter({ visible: true });
  await expect(indicator).toHaveAttribute(
    "aria-label",
    "Selected agent: Hoodit",
  );
  await widget.sendAndSettle("agent context turn");
  const chatUrl = page.url();
  await page.reload();
  await widget.ready();
  await expect(indicator).toHaveText("Hoodit");
  await widget.newChat();
  await expect(indicator).toHaveText("Hoodit");
  await page.goBack();
  await expect(page).toHaveURL(chatUrl);
  await expect(
    widget.replies.filter({ hasText: "Fake reply: agent context turn" }),
  ).toBeVisible();
  await expect(indicator).toHaveText("Hoodit");
});

test("an unlocked URL agent and its funding survive reload", async ({
  widget,
}) => {
  const page = widget.page;
  await page.goto("/?agent=aomi%2Fhoodit&funding=user_byok");
  await widget.ready();
  const indicator = page
    .getByTestId(testIds.composerSelectedAgent)
    .filter({ visible: true });
  await expect(indicator).toHaveText("Hoodit");
  await page.reload();
  await widget.ready();
  await expect(indicator).toHaveText("Hoodit");
  expect(new URL(page.url()).searchParams.get("funding")).toBe("user_byok");
  await page.goto("/");
  await widget.ready();
  await expect(page.getByTestId(testIds.composerSelectedAgent)).toHaveCount(0);
});
