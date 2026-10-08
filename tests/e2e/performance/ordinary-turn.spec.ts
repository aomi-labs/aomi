import { writeFile } from "node:fs/promises";
import type { CDPSession } from "@playwright/test";
import { test, expect } from "../journey-fixture";
import type { WidgetPage } from "../pom/widget";
import {
  perfObserverScript,
  readPerfWindow,
  startPerfWindow,
  type PerfSummary,
} from "./observer";

// The fake sends a whole tool turn in one page, which renders in one 40-90 ms
// task at 4x CPU, so the throttled turn only guards against regressions.
const THROTTLED_TASK_BUDGET_MS = 100;

async function measureTurn(
  widget: WidgetPage,
  cdp: CDPSession,
  prompt: string,
  rate: number,
): Promise<PerfSummary> {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await widget.input.fill(prompt);
  await expect(widget.send).toBeEnabled();
  await startPerfWindow(widget.page);
  await widget.send.click();
  await expect(
    widget.replies.filter({ hasText: `Fake reply: ${prompt}` }),
  ).toBeVisible();
  await expect(widget.stop).toBeHidden();
  return readPerfWindow(widget.page);
}

// A tool turn must not block the main thread, write to the sidebar or remount
// the widget. AOMI_PERF_PROFILE=1 attaches a CPU profile of the 4x CPU turn.
test("an ordinary tool turn has no long tasks, sidebar writes or remounts", async ({
  widget,
}, info) => {
  // Warm the runtime and the first thread's metadata first.
  await widget.sendAndSettle("hi");
  await widget.page.evaluate(perfObserverScript);
  const cdp = await widget.page.context().newCDPSession(widget.page);
  const profile = process.env.AOMI_PERF_PROFILE === "1";
  let turns: Record<"fullSpeed" | "throttled", PerfSummary>;
  try {
    const fullSpeed = await measureTurn(widget, cdp, "[tool] balance", 1);
    if (profile) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
    }
    const throttled = await measureTurn(widget, cdp, "[tool] prices", 4);
    turns = { fullSpeed, throttled };
    if (profile) {
      const path = info.outputPath("ordinary-turn.cpuprofile");
      await writeFile(
        path,
        JSON.stringify((await cdp.send("Profiler.stop")).profile),
      );
      await info.attach("cpu-profile", {
        path,
        contentType: "application/json",
      });
    }
  } finally {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.detach();
  }
  await info.attach("ordinary-turn", {
    body: JSON.stringify(turns, null, 2),
    contentType: "application/json",
  });
  expect(turns.fullSpeed.longTasks).toEqual([]);
  expect(Math.max(0, ...turns.throttled.longTasks)).toBeLessThan(
    THROTTLED_TASK_BUDGET_MS,
  );
  for (const metrics of Object.values(turns)) {
    expect(metrics.sidebarMutations).toBe(0);
    expect(metrics.rootReplacements).toBe(0);
    expect(metrics.chatReplacements).toBe(0);
  }
});
