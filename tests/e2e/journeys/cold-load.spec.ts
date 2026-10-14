import { test, expect } from "../journey-fixture";

test("composer accepts input as soon as it is visible", async ({ widget }) => {
  await widget.input.fill("draft before session check");
  await expect(widget.send).toBeEnabled();
  await expect(widget.input).toHaveText("draft before session check");
});
