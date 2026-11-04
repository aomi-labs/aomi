import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("rename and archive update the sidebar", async ({ widget, agent }) => {
  await widget.sendAndSettle("sidebar journey");
  await widget.options("Title: sidebar journey");
  await widget.activate(
    widget.page.getByRole("button", { name: "Rename", exact: true }),
  );
  await widget.page
    .getByRole("textbox", { name: "Chat title" })
    .fill("Renamed journey");
  await widget.activate(
    widget.page.getByRole("button", { name: "Save chat title" }),
  );
  await expect(
    widget.rows.filter({ hasText: "Renamed journey" }),
  ).toBeVisible();
  await widget.options("Renamed journey");
  await widget.activate(widget.page.getByTestId(testIds.archive));
  await expect(widget.rows.filter({ hasText: "Renamed journey" })).toHaveCount(
    0,
  );
  const archived = agent
    .sessions()
    .find((s) => s.title === "Renamed journey" && s.archived);
  expect(archived).toBeTruthy();
  // The archived chat was the open one: the view moves to an empty chat at
  // once, without a reload, and the URL stops naming the archived thread.
  await expect(
    widget.replies.filter({ hasText: "Fake reply: sidebar journey" }),
  ).toHaveCount(0);
  await expect(widget.userMessages).toHaveCount(0);
  await expect(widget.input).toBeVisible();
  await expect(widget.input).toHaveText("");
  expect(widget.page.url()).not.toContain(archived!.id);
});
