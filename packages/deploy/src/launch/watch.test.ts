// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  runtimeAppsReady,
  waitForAppsToLoad,
  waitForDeploymentReady,
} from "../src/launch/watch";

const expected = [{ name: "playground-example", releaseTag: "release-2" }];

function snapshot(loaded: boolean) {
  return {
    apps: [
      {
        id: 17,
        name: "playground-example",
        app_release_tag: "release-2",
        is_active: true,
        loaded,
      },
    ],
  };
}

describe("runtime readiness watcher", () => {
  it("does not treat an accepted but unloaded activation as live", () => {
    expect(runtimeAppsReady(snapshot(false), expected)).toBe(false);
    expect(runtimeAppsReady(snapshot(true), expected)).toBe(true);
  });

  it("polls until the expected release is loaded", async () => {
    const poll = vi
      .fn<() => Promise<ReturnType<typeof snapshot>>>()
      .mockResolvedValueOnce(snapshot(false))
      .mockResolvedValueOnce(snapshot(true));
    const progress: number[] = [];

    const result = await waitForAppsToLoad(poll, expected, {
      intervalMs: 0,
      timeoutMs: 1000,
      onProgress: ({ ready, total }) => progress.push(ready / total),
    });

    expect(poll).toHaveBeenCalledTimes(2);
    expect(progress).toEqual([0, 1]);
    expect(result.apps[0]?.loaded).toBe(true);
  });

  it("can be cancelled while waiting for the runtime", async () => {
    const controller = new AbortController();
    const poll = vi.fn(async () => snapshot(false));
    const pending = waitForAppsToLoad(poll, expected, {
      intervalMs: 1000,
      timeoutMs: 5000,
      signal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails immediately when the runtime read is permanently rejected", async () => {
    const error = Object.assign(new Error("project not found for this user"), {
      status: 404,
    });
    const poll = vi.fn().mockRejectedValue(error);

    await expect(
      waitForAppsToLoad(poll, expected, {
        intervalMs: 0,
        timeoutMs: 1000,
        isFatal: (value) =>
          typeof value === "object" &&
          value !== null &&
          "status" in value &&
          value.status === 404,
      }),
    ).rejects.toBe(error);
    expect(poll).toHaveBeenCalledOnce();
  });

  it("includes the last transient runtime error when timing out", async () => {
    const poll = vi
      .fn()
      .mockRejectedValue(new Error("backend temporarily unavailable"));

    await expect(
      waitForAppsToLoad(poll, expected, {
        intervalMs: 0,
        timeoutMs: 0,
      }),
    ).rejects.toThrow(
      "Timed out waiting for playground-example to load in this runtime. Last error: backend temporarily unavailable",
    );
  });

  it("reports transient failures as polling attempts", async () => {
    const error = new Error("runtime temporarily unavailable");
    const poll = vi
      .fn<() => Promise<ReturnType<typeof snapshot>>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(snapshot(true));
    const progress: Array<{ attempt: number; error?: unknown }> = [];

    await waitForAppsToLoad(poll, expected, {
      intervalMs: 0,
      timeoutMs: 1000,
      onProgress: ({ attempt, error: progressError }) =>
        progress.push({ attempt, error: progressError }),
    });

    expect(progress).toEqual([
      { attempt: 1, error },
      { attempt: 2, error: undefined },
    ]);
  });
});

describe("deployment readiness watcher", () => {
  it("shares CI polling and returns the ready status", async () => {
    const poll = vi
      .fn<
        () => Promise<{ state: "pending" | "ready"; releaseTags: string[] }>
      >()
      .mockResolvedValueOnce({ state: "pending", releaseTags: [] })
      .mockResolvedValueOnce({ state: "ready", releaseTags: ["release-2"] });
    const states: string[] = [];

    const result = await waitForDeploymentReady(poll, {
      intervalMs: 0,
      timeoutMs: 1000,
      onProgress: (status) => states.push(status.state),
    });

    expect(result.state).toBe("ready");
    expect(states).toEqual(["pending", "ready"]);
  });

  it("fails immediately when CI status returns a fatal client error", async () => {
    const error = Object.assign(new Error("deployment not found"), {
      status: 404,
    });
    const poll = vi.fn().mockRejectedValue(error);

    await expect(
      waitForDeploymentReady(poll, {
        intervalMs: 0,
        timeoutMs: 1000,
        isFatal: (value) =>
          typeof value === "object" &&
          value !== null &&
          "status" in value &&
          value.status === 404,
      }),
    ).rejects.toBe(error);
    expect(poll).toHaveBeenCalledOnce();
  });

  it("includes the last transient CI error when timing out", async () => {
    const poll = vi
      .fn()
      .mockRejectedValue(new Error("GitHub status temporarily unavailable"));

    await expect(
      waitForDeploymentReady(poll, {
        intervalMs: 0,
        timeoutMs: 0,
      }),
    ).rejects.toThrow(
      "Timed out waiting for the deployment to become ready. Last error: GitHub status temporarily unavailable",
    );
  });
});
