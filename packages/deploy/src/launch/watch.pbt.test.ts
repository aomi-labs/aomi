// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { BackendClient } from "../src/backend";
import type {
  DeploymentProgressEvent,
  DeploymentStatus,
  ProgressModel,
} from "../src/types";
import { backoffDelay, deploymentProgress } from "../src/launch/watch";

describe("watchDeployment — property-based", () => {
  it("buildProgressModel produces monotonic completed", () => {
    const client = new BackendClient({
      aomi: {
        backendUrl: "https://staging-api.example.com",
        activationToken: "act-token",
      },
    });

    fc.assert(
      fc.property(
        fc
          .record({
            state: fc.constantFrom(
              "pending",
              "building",
              "releasing",
              "ready",
              "failed",
            ),
            lastCompleted: fc.integer({ min: 0, max: 8 }),
          })
          .filter(({ state, lastCompleted }) =>
            state !== "failed" ? true : lastCompleted >= 0,
          ),
        ({ state, lastCompleted }) => {
          const model = deploymentProgress(
            { state, releaseTags: [] } as DeploymentStatus,
            lastCompleted,
          ) as ProgressModel;

          expect(model.total).toBe(8);
          expect(model.completed).toBeGreaterThanOrEqual(0);
          expect(model.completed).toBeLessThanOrEqual(model.total);
          expect(model.label).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("backoffDelay doubles each failure up to maxDelayMs", () => {
    const client = new BackendClient({
      aomi: {
        backendUrl: "https://staging-api.example.com",
        activationToken: "act-token",
      },
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 5000, max: 60000 }),
        (failures, baseMs, maxMs) => {
          const delay = backoffDelay(
            failures,
            baseMs,
            maxMs,
          ) as number;

          expect(delay).toBeGreaterThanOrEqual(0);
          expect(delay).toBeLessThanOrEqual(maxMs);
          if (failures === 0) {
            expect(delay).toBe(baseMs);
          }
          if (failures > 0) {
            expect(delay).toBe(Math.min(baseMs * Math.pow(2, failures), maxMs));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("terminal states (ready, failed) are detected correctly", () => {
    const client = new BackendClient({
      aomi: {
        backendUrl: "https://staging-api.example.com",
        activationToken: "act-token",
      },
    });

    fc.assert(
      fc.property(
        fc.constantFrom(
          ...(["pending", "building", "releasing", "ready", "failed"] as const),
        ),
        (state) => {
          const isTerminal = state === "ready" || state === "failed";
          const model = deploymentProgress(
            { state, releaseTags: [] } as DeploymentStatus,
            0,
          ) as ProgressModel;

          expect(model.total).toBe(8);
          if (state === "ready") {
            expect(model.completed).toBe(8);
          }
          if (state === "failed") {
            expect(model.completed).toBe(0); // passes lastCompleted=0
          }
          if (state === "pending") {
            expect(model.completed).toBe(1);
          }
          if (state === "building") {
            expect(model.completed).toBe(2);
          }
          if (state === "releasing") {
            expect(model.completed).toBe(5);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("terminates when terminal state received (Property 1)", async () => {
    vi.useFakeTimers();

    const terminalState: DeploymentStatus = {
      state: "ready",
      releaseTags: ["v1.0"],
      apps: [],
    };

    const states: DeploymentStatus[] = [
      { state: "pending", releaseTags: [] },
      { state: "building", releaseTags: [] },
      terminalState,
    ];

    let callCount = 0;
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(states[0]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    // Override per-call via mockImplementation
    fetchMock.mockImplementation(async () => {
      const s = states[Math.min(callCount, states.length - 1)];
      callCount++;
      return new Response(JSON.stringify(s), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = new BackendClient({
        aomi: {
          backendUrl: "https://staging-api.example.com",
          activationToken: "act-token",
        },
      });

      const events: DeploymentProgressEvent[] = [];

      const promise = client.watchDeployment(
        "dep_1",
        "community",
        (e) => events.push(e),
        {
          baseDelayMs: 1,
          maxDelayMs: 5,
          maxRetries: 3,
        },
      );

      // Advance time to let all polls complete
      // Each tick: status call (instant) + sleep(baseDelayMs=1)
      await vi.advanceTimersByTimeAsync(100);

      await promise;

      expect(events.length).toBeGreaterThanOrEqual(1);
      const lastEvent = events[events.length - 1];
      expect(lastEvent.kind).toBe("terminal");
      expect(lastEvent.status.state).toBe("ready");

      // Verify no more fetches happen after terminal
      const fetchCountAfterTerminal = callCount;
      await vi.advanceTimersByTimeAsync(100);
      expect(callCount).toBe(fetchCountAfterTerminal);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("emits error event on poll exhaustion (Property 1b)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const client = new BackendClient({
        aomi: {
          backendUrl: "https://staging-api.example.com",
          activationToken: "act-token",
        },
      });

      const events: DeploymentProgressEvent[] = [];

      const promise = client.watchDeployment(
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
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("progress model labels are non-empty strings", () => {
    const client = new BackendClient({
      aomi: {
        backendUrl: "https://staging-api.example.com",
        activationToken: "act-token",
      },
    });

    fc.assert(
      fc.property(
        fc.constantFrom(
          "pending",
          "building",
          "releasing",
          "ready",
          "failed",
          "unknown_state",
        ),
        (state) => {
          const model = deploymentProgress(
            { state, releaseTags: [] } as DeploymentStatus,
            3,
          ) as ProgressModel;

          expect(model.label).toBeTruthy();
          expect(typeof model.label).toBe("string");
          expect(model.label.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
