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
  return events;
}

describe("deploymentProgress", () => {
  it.each([
    ["pending", 1],
    ["building", 2],
    ["releasing", 5],
    ["ready", 8],
    ["no_ci", 3],
    ["failed", 3],
    ["unknown_state", 3],
  ])("maps %s (lastCompleted=3) to %i/8", (state, completed) => {
    const model = deploymentProgress(
      { state, releaseTags: [] } as DeploymentStatus,
      3,
    );
    expect(model.total).toBe(8);
    expect(model.completed).toBe(completed);
    expect(model.label).toBeTruthy();
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
  it("always emits a terminal event last, keeps progress valid and monotonic, and stops polling", async () => {
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
          const events = await runWatch([...prefix, terminal, ...trailing]);

          expect(events.length).toBeGreaterThanOrEqual(1);
          const lastEvent = events[events.length - 1];
          expect(lastEvent.kind).toBe("terminal");
          expect(["ready", "failed", "no_ci"]).toContain(lastEvent.status.state);

          let lastCompleted = -1;
          for (const event of events) {
            expect(event.progress).toBeDefined();
            expect(event.progress.total).toBeGreaterThan(0);
            expect(event.progress.completed).toBeGreaterThanOrEqual(0);
            expect(event.progress.completed).toBeLessThanOrEqual(
              event.progress.total,
            );
            expect(event.progress.label.length).toBeGreaterThan(0);
            expect(event.progress.completed).toBeGreaterThanOrEqual(
              lastCompleted,
            );
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

    expect(events.length).toBeGreaterThanOrEqual(1);
    const lastEvent = events[events.length - 1];
    expect(lastEvent.kind).toBe("error");
    expect(lastEvent.progress).toBeDefined();
    expect(lastEvent.error).toBeDefined();
  });
});
