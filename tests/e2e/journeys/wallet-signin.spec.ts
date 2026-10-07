import { test, expect } from "../journey-fixture";

for (const started of [false, true]) {
  test(`opening wallet choice preserves ${started ? "existing" : "empty"} chat and draft`, async ({
    widget,
  }) => {
    if (started) await widget.sendAndSettle("chat before sign-in");
    await widget.input.fill("draft during sign-in");
    await widget.openSidebar();
    await widget.page
      .getByRole("button", { name: "Sign in", exact: true })
      .filter({ visible: true })
      .first()
      .click();
    const picker = widget.page.getByRole("dialog", {
      name: "Sign in to Aomi",
    });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("Wallets", { exact: true })).toBeVisible();
    await widget.page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await widget.closeSidebar();
    await expect(widget.input).toHaveText("draft during sign-in");
    if (started) {
      await expect(widget.userMessages).toHaveText("chat before sign-in");
      await expect(widget.replies).toHaveText(
        "Fake reply: chat before sign-in",
      );
    }
  });
}
