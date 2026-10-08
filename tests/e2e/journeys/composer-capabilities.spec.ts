import { test, expect } from "../journey-fixture";

test("a chain picked from the composer is sent as one hint and leaves no chip behind", async ({
  widget,
  agent,
}) => {
  const page = widget.page;
  const picker = page.getByRole("listbox", {
    name: "Apps, skills, and chains",
  });
  const base = widget.input.getByLabel("chain Base", { exact: true });
  const baseOption = picker
    .getByRole("option")
    .filter({ has: page.getByText("Base", { exact: true }) });

  await page.getByRole("button", { name: "Add app, skill, or chain" }).click();
  await expect(picker).toBeVisible();
  await expect(picker).toBeInViewport({ ratio: 1 });
  await widget.input.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(widget.input).toBeFocused();

  await widget.input.pressSequentially("Check balances @8453");
  await expect(baseOption).toHaveAttribute("aria-selected", "true");
  await widget.input.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(base).toBeVisible();
  await widget.input.press("Backspace");
  await expect(base).toHaveCount(0);
  await widget.input.pressSequentially("@8453");
  await widget.input.press("Tab");
  await expect(base).toBeVisible();

  await widget.send.click();
  await expect(widget.stop).toBeHidden();
  const message = agent.starts().at(-1)?.message ?? "";
  expect(message).toContain("Check balances");
  expect(message).toContain("Preferred execution chain ids: eip155:8453.");
  expect(message.match(/<AOMI_UI_CAPABILITY_HINTS>/g)).toHaveLength(1);
  expect(message).not.toContain("eip155:84532");
  await expect(
    widget.userMessages.filter({ hasText: "AOMI_UI_CAPABILITY_HINTS" }),
  ).toHaveCount(0);
  await expect(base).toHaveCount(0);
});
