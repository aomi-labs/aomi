import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("a real 402 opens the payment setup gate and cannot admit or replay a turn", async ({
  widget,
  agent,
}) => {
  await widget.submit("[pay] premium");
  const gate = widget.page.getByTestId(testIds.paygate);
  await expect(gate).toBeVisible();
  await expect(
    gate.getByRole("heading", { name: "Set up BYOK" }),
  ).toBeVisible();
  await expect(
    gate.getByRole("button", { name: "Save and use BYOK" }),
  ).toBeDisabled();
  expect(agent.starts()).toHaveLength(0);
  expect(agent.requestsSince(0, "chat.start")).toHaveLength(1);
  await expect(widget.stop).toBeHidden();
  await gate.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(gate).toBeHidden();
  expect(agent.starts()).toHaveLength(0);
  expect(agent.requestsSince(0, "chat.start")).toHaveLength(1);
  await widget.sendAndSettle("after declining payment");
});
