import { describe, expect, it } from "vitest";
import type { DeploymentStatus } from "@aomi-labs/deploy";
import { ciProgress, stageProgress } from "./deploy-flow-progress";

function status(over: Partial<DeploymentStatus> = {}): DeploymentStatus {
  return { state: "building", releaseTags: [], ...over };
}

describe("ciProgress", () => {
  it("maps CI states into the bar's CI segment, in order", () => {
    const pending = ciProgress(status({ state: "pending" }), 0).progress;
    const building = ciProgress(status({ state: "building" }), 1).progress;
    const releasing = ciProgress(status({ state: "releasing" }), 2).progress;
    const ready = ciProgress(status({ state: "ready" }), 5).progress;

    expect(pending.percent).toBeGreaterThan(0);
    expect(pending.percent).toBeLessThan(building.percent);
    expect(building.percent).toBeLessThan(releasing.percent);
    expect(releasing.percent).toBeLessThan(ready.percent);
    // CI never claims the whole bar: activation still has to run.
    expect(ready.percent).toBeLessThan(100);
    expect(building.label).toBe("Building CI");
  });

  it("holds the last completed step through a no_ci poll", () => {
    const { model, progress } = ciProgress(status({ state: "building" }), 0);
    const stalled = ciProgress(status({ state: "no_ci" }), model.completed);
    expect(stalled.progress.percent).toBe(progress.percent);
  });

  it("surfaces the CI run url when the status carries one", () => {
    const url = "https://github.com/a/b/actions/runs/1";
    expect(ciProgress(status({ ci: { url } }), 0).progress.ciUrl).toBe(url);
    expect(ciProgress(status(), 0).progress.ciUrl).toBeNull();
  });
});

describe("stageProgress", () => {
  it("orders the non-CI stages around the CI segment", () => {
    const deploying = stageProgress("deploying", "Dispatching build");
    const activating = stageProgress("activating", "Activating release");
    const done = stageProgress("done", "Live");
    const ciReady = ciProgress(status({ state: "ready" }), 0).progress;

    expect(deploying.percent).toBeLessThan(ciReady.percent);
    expect(ciReady.percent).toBeLessThan(activating.percent);
    expect(done.percent).toBe(100);
  });

  it("carries a CI url forward into the later stages", () => {
    const url = "https://github.com/a/b/actions/runs/1";
    expect(stageProgress("activating", "Activating release", url).ciUrl).toBe(
      url,
    );
  });
});
