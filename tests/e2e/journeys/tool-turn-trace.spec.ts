import { test, expect } from "../journey-fixture";
import { testIds } from "../../../packages/widget/src/test-ids";

test("a tool turn keeps its trace beside the final answer", async ({
  widget,
}) => {
  await widget.sendAndSettle("[tool] balance");
  await expect(widget.trace).toBeVisible();
  await expect(
    widget.trace.getByTestId(testIds.traceStep).first(),
  ).toBeVisible();
});
