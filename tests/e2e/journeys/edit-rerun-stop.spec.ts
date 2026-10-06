import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("Stop interrupts a held turn and permits a later reply", async ({
  widget,
  agent,
}) => {
  await widget.submit("[slow] held turn");
  await expect(widget.stop).toBeVisible();
  await widget.stop.click();
  await expect(widget.stop).toBeHidden();
  expect(agent.log.some((r) => r.route === "chat.interrupt")).toBe(true);
  await widget.sendAndSettle("after stop");
});
test("edit and rerun send branch intents", async ({ widget, agent }) => {
  await widget.sendAndSettle("original");
  await widget.userMessages.hover();
  await widget.page.getByTestId(testIds.editMessage).click();
  await widget.page
    .getByRole("textbox", { name: "Edit message" })
    .fill("edited");
  await widget.page.getByRole("button", { name: "Save and resend" }).click();
  await expect(
    widget.replies.filter({ hasText: "Fake edited reply: edited" }),
  ).toBeVisible();
  expect(agent.starts().at(-1)?.edit).toBeTruthy();
  await widget.replies.last().hover();
  await widget.page.getByTestId(testIds.rerun).last().click();
  await expect(
    widget.replies.filter({ hasText: "Fake rerun reply:" }),
  ).toBeVisible();
  expect(
    agent.starts().at(-1)?.regenerate ?? agent.starts().at(-1)?.edit,
  ).toBeTruthy();
});
