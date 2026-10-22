// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { BackendClient } from "../backend";
import type { DeploymentProgressEvent, DeploymentStatus } from "../types";
import { backoffDelay, deploymentProgress } from "./watch";

function newClient(): BackendClient {
  return new BackendClient({
    aomi: {
      backendUrl: "https://staging-api.example.com",
      activationToken: "act-token",
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Fetch mock that returns states in order, then repeats the last.
function mockStatusSequence(states: string[]) {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const state = states[
      Math.min(idx, states.length - 1)
    ] as DeploymentStatus["state"];
    idx++;
    return new Response(
      JSON.stringify({ state, releaseTags: [] } satisfies DeploymentStatus),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

// Runs watchDeployment under fake timers. Callers must include a terminal
// state in `states`, otherwise the watcher polls forever.
async function runWatch(states: string[]) {
  vi.useFakeTimers();
  const events: DeploymentProgressEvent[] = [];
  const fetchMock = mockStatusSequence(states);
  vi.stubGlobal("fetch", fetchMock);

  const promise = newClient().watchDeployment(
    "dep_1",
    "community",
    (e) => events.push(e),
    { baseDelayMs: 1, maxDelayMs: 5, maxRetries: 3 },
  );

  await vi.advanceTimersByTimeAsync(5000);
  await promise;
  const fetchCount = fetchMock.mock.calls.length;
  // No further polling once a terminal event has been emitted.
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchMock).toHaveBeenCalledTimes(fetchCount);
  vi.useRealTimers();
  return { events, fetchCount };
}

describe("deploymentProgress", () => {
  it.each([
    ["pending", 1, "Waiting for build"],
    ["building", 2, "Building CI"],
    ["releasing", 5, "Verifying release assets"],
    ["ready", 8, "Build ready"],
    ["no_ci", 3, "No CI"],
    ["failed", 3, "Build failed"],
    ["unknown_state", 3, "Waiting for build"],
  ])("maps %s (lastCompleted=3) to %i/8 %s", (state, completed, label) => {
    expect(
      deploymentProgress({ state, releaseTags: [] } as DeploymentStatus, 3),
    ).toEqual({ completed, total: 8, label });
  });
});

describe("backoffDelay", () => {
  it.each([
    [0, 1000, 30000, 1000],
    [1, 1000, 30000, 2000],
    [2, 1000, 30000, 4000],
    [4, 1000, 30000, 16000],
    [5, 1000, 30000, 30000],
    [20, 100, 5000, 5000],
  ])(
    "failures=%i base=%i max=%i -> %i",
    (failures, baseMs, maxMs, expected) => {
      expect(backoffDelay(failures, baseMs, maxMs)).toBe(expected);
    },
  );

  it("delay at failure n is always >= delay at failure n-1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 7 }), (n) => {
        expect(backoffDelay(n, 3000, 30000)).toBeGreaterThanOrEqual(
          backoffDelay(n - 1, 3000, 30000),
        );
      }),
      { numRuns: 50 },
    );
  });

  it("delay never exceeds maxDelayMs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 5000, max: 60000 }),
        (failures, baseMs, maxMs) => {
          expect(backoffDelay(failures, baseMs, maxMs)).toBeLessThanOrEqual(
            maxMs,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("watchDeployment", () => {
  it("emits one event per poll, ends on the first terminal state, keeps progress valid and monotonic, and stops polling", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("pending", "building", "releasing"), {
          maxLength: 6,
        }),
        fc.constantFrom("ready", "failed", "no_ci"),
        fc.array(
          fc.constantFrom("pending", "building", "releasing", "ready"),
          { maxLength: 2 },
        ),
        async (prefix, terminal, trailing) => {
          const { events, fetchCount } = await runWatch([
            ...prefix,
            terminal,
            ...trailing,
          ]);

          expect(fetchCount).toBe(prefix.length + 1);
          expect(events.map((e) => e.kind)).toEqual([
            ...prefix.map(() => "progress"),
            "terminal",
          ]);
          expect(events.map((e) => e.status.state)).toEqual([
            ...prefix,
            terminal,
          ]);

          let lastCompleted = 0;
          for (const event of events) {
            expect(event.progress.total).toBe(8);
            expect(event.progress.completed).toBeGreaterThanOrEqual(
              lastCompleted,
            );
            expect(event.progress.completed).toBeLessThanOrEqual(8);
            lastCompleted = event.progress.completed;
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("emits an error event after maxRetries consecutive poll failures", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const events: DeploymentProgressEvent[] = [];
    const promise = newClient().watchDeployment(
      "dep_1",
      "community",
      (e) => events.push(e),
      { baseDelayMs: 1, maxDelayMs: 5, maxRetries: 3 },
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(events.map((e) => e.kind)).toEqual([
      "warning",
      "warning",
      "warning",
      "error",
    ]);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.status).toEqual({
      state: "failed",
      releaseTags: [],
      message: "Polling stopped after 3 consecutive failures",
    });
    expect(lastEvent.progress).toEqual({
      completed: 0,
      total: 8,
      label: "Waiting for build",
    });
    expect(lastEvent.error?.message).toBe(
      "Polling stopped after 3 consecutive failures",
    );
  });
});
