import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

// Portal only: an embed takes its app from props, not from the page URL.
test("a locked URL app stays selected through a turn, reload, new chat and history", async ({
  widget,
}) => {
  const page = widget.page;
  await page.goto("/?app=hoodit&application_id=2937810&lock_app=1");
  await widget.ready();
  const indicator = page
    .getByTestId(testIds.composerSelectedApp)
    .filter({ visible: true });
  await expect(indicator).toHaveAttribute("aria-label", "Selected app: Hoodit");
  await widget.sendAndSettle("app context turn");
  const chatUrl = page.url();
  await page.reload();
  await widget.ready();
  await expect(indicator).toHaveText("Hoodit");
  await widget.newChat();
  await expect(indicator).toHaveText("Hoodit");
  await page.goBack();
  await expect(page).toHaveURL(chatUrl);
  await expect(
    widget.replies.filter({ hasText: "Fake reply: app context turn" }),
  ).toBeVisible();
  await expect(indicator).toHaveText("Hoodit");
});

test("an unlocked URL app and its funding survive reload", async ({
  widget,
}) => {
  const page = widget.page;
  await page.goto("/?app=hoodit&application_id=2937810&funding=user_byok");
  await widget.ready();
  const indicator = page
    .getByTestId(testIds.composerSelectedApp)
    .filter({ visible: true });
  await expect(indicator).toHaveText("Hoodit");
  await page.reload();
  await widget.ready();
  await expect(indicator).toHaveText("Hoodit");
  expect(new URL(page.url()).searchParams.get("funding")).toBe("user_byok");
  await page.goto("/");
  await widget.ready();
  await expect(page.getByTestId(testIds.composerSelectedApp)).toHaveCount(0);
});
