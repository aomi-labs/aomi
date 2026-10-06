import { test, expect } from "../journey-fixture";

test("opening wallet choice preserves chat and draft", async ({ widget }) => {
  await widget.input.fill("draft during sign-in");
  await widget.openSidebar();
  await widget.page
    .getByRole("button", { name: "Sign in", exact: true })
    .filter({ visible: true })
    .first()
    .click();
  const picker = widget.page.getByRole("dialog", {
    name: /Sign in to Aomi|Add a wallet/,
  });
  await expect(picker).toBeVisible();
  await widget.page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await widget.closeSidebar();
  await expect(widget.input).toHaveText("draft during sign-in");
});
