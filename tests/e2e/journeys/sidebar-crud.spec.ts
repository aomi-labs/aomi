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
  expect(
    agent.sessions().some((s) => s.title === "Renamed journey" && s.archived),
  ).toBe(true);
});
