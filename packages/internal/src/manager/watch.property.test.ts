// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { BackendClient } from "./user";
import type { DeploymentProgressEvent, DeploymentStatus } from "@aomi-labs/deploy";
import { backoffDelay, deploymentProgress } from "@aomi-labs/deploy/launch";

const client = new BackendClient({
  aomi: {
    backendUrl: "https://staging-api.example.com",
    activationToken: "act-token",
  },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
});

describe("watchDeployment", () => {
  it("always emits a terminal event last, keeps progress valid and monotonic, and stops polling", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("pending", "building", "releasing"), {
          maxLength: 6,
        }),
        fc.constantFrom("ready", "failed", "no_ci"),
        fc.array(fc.constantFrom("pending", "building", "releasing", "ready"), {
          maxLength: 2,
        }),
        async (prefix, terminal, trailing) => {
          vi.useFakeTimers();
          const states = [...prefix, terminal, ...trailing];
          let index = 0;
          const fetchMock = vi.fn(
            async () =>
              new Response(
                JSON.stringify({
                  state: states[Math.min(index++, states.length - 1)],
                  releaseTags: [],
                }),
              ),
          );
          vi.stubGlobal("fetch", fetchMock);
          const events: DeploymentProgressEvent[] = [];
          const pending = client.watchDeployment(
            "dep_1",
            "community",
            (e) => events.push(e),
            {
              baseDelayMs: 1,
              maxDelayMs: 5,
              maxRetries: 3,
            },
          );
          await vi.advanceTimersByTimeAsync(5000);
          await pending;
          expect(fetchMock).toHaveBeenCalledTimes(prefix.length + 1);
          await vi.advanceTimersByTimeAsync(100);
          expect(fetchMock).toHaveBeenCalledTimes(prefix.length + 1);
          vi.useRealTimers();

          expect(events.length).toBeGreaterThanOrEqual(1);
          const lastEvent = events[events.length - 1];
          expect(lastEvent.kind).toBe("terminal");
          expect(lastEvent.status.state).toBe(terminal);

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
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    const events: DeploymentProgressEvent[] = [];
    const promise = client.watchDeployment(
      "dep_1",
      "community",
      (e) => events.push(e),
      { baseDelayMs: 1, maxDelayMs: 5, maxRetries: 3 },
    );

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events.map((event) => event.kind)).toEqual([
      "warning",
      "warning",
      "warning",
      "error",
    ]);
  });
});
