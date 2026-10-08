import { test, expect } from "../journey-fixture";

test("A to B to A to C to A retains draft, trace and scroll without history reads", async ({
  widget,
  agent,
}) => {
  // A real overflowing conversation makes scroll restoration observable.
  const promptA = `[tool] chat A\n${"A retained paragraph with enough content to scroll.\n".repeat(60)}`;
  await widget.sendAndSettle(promptA);
  const traceToggle = widget.trace.getByRole("button").first();
  await expect(traceToggle).toHaveAttribute("aria-expanded", "false");
  await traceToggle.click();
  await expect(traceToggle).toHaveAttribute("aria-expanded", "true");
  await widget.input.fill("unfinished A");
  const viewport = widget.messageList;
  await expect
    .poll(() =>
      viewport.evaluate((node) => node.scrollHeight - node.clientHeight),
    )
    .toBeGreaterThan(150);
  await viewport.evaluate((node) => {
    node.scrollTop = 100;
  });
  await expect
    .poll(() => viewport.evaluate((node) => node.scrollTop))
    .toBe(100);
  const column = await viewport.boundingBox();
  if (!column) throw new Error("Chat viewport has no visible bounds");
  await widget.newChat();
  await widget.sendAndSettle("chat B");
  const mark = agent.mark();
  const revisitA = async () => {
    await widget.select("Title: [tool] chat A");
    await expect(widget.input).toHaveText("unfinished A");
    await expect(
      widget.replies.filter({ hasText: "Fake reply: [tool] chat A" }),
    ).toBeVisible();
    await expect(traceToggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .poll(() => viewport.evaluate((node) => node.scrollTop))
      .toBe(100);
    const restored = await viewport.boundingBox();
    expect(restored).not.toBeNull();
    expect(Math.abs(restored!.x - column.x)).toBeLessThan(1);
    expect(Math.abs(restored!.width - column.width)).toBeLessThan(1);
  };
  await revisitA();
  await widget.newChat();
  await widget.sendAndSettle("chat C");
  await revisitA();
  expect(
    agent
      .requestsSince(mark)
      .filter((r) => r.route === "chat.poll" || r.route === "sessions.get"),
  ).toEqual([]);
});
