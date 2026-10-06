// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";

import { BackendClient } from "../backend";
import type {
  DeploymentProgressEvent,
  DeploymentStatus,
  ProgressModel,
} from "../types";
import { backoffDelay, deploymentProgress } from "../launch/watch";

// Shared client reused in unit-level property tests (Properties 4)
let client: BackendClient;

beforeEach(() => {
  client = new BackendClient({
    aomi: {
      backendUrl: "https://staging-api.example.com",
      activationToken: "act-token",
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Helper: build a fetch mock that returns states in order, then repeats the last
function mockStatusSequence(states: string[]) {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const state = states[Math.min(idx, states.length - 1)] as DeploymentStatus["state"];
    idx++;
    return new Response(
      JSON.stringify({ state, releaseTags: [] } satisfies DeploymentStatus),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

// Helper: collect events from watchDeployment with fake timers
async function runWatch(
  states: string[],
  signal?: AbortSignal,
): Promise<DeploymentProgressEvent[]> {
  vi.useFakeTimers();
  const events: DeploymentProgressEvent[] = [];
  const fetchMock = mockStatusSequence(states);
  vi.stubGlobal("fetch", fetchMock);

  const promise = client.watchDeployment("dep_1", "community", (e) =>
    events.push(e),
    { baseDelayMs: 1, maxDelayMs: 5, maxRetries: 3, signal },
  );

  await vi.advanceTimersByTimeAsync(5000);
  await promise;
  return events;
}

// Feature: deploy-flow-production-ready, Property 1: watchDeployment terminates on terminal state
describe("Property 1 — terminates on terminal state", () => {
  it("always emits a terminal event last and stops polling after it", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom("pending", "building", "releasing", "ready", "failed"),
          { minLength: 1, maxLength: 8 },
        ),
        async (states) => {
          // Ensure at least one terminal state somewhere in the sequence
          const hasTerminal = states.some(
            (s) => s === "ready" || s === "failed",
          );
          if (!hasTerminal) return; // skip non-terminal sequences for this property

          const events = await runWatch(states);

          expect(events.length).toBeGreaterThanOrEqual(1);
          const lastEvent = events[events.length - 1];
          expect(lastEvent.kind).toBe("terminal");
          expect(["ready", "failed"]).toContain(lastEvent.status.state);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: deploy-flow-production-ready, Property 2: Every emitted event carries valid ProgressModel
describe("Property 2 — every event has a valid ProgressModel", () => {
  it("all progress events carry a valid ProgressModel", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom("pending", "building", "releasing", "ready", "failed"),
          { minLength: 1, maxLength: 8 },
        ),
        async (states) => {
          const events = await runWatch(states);

          for (const event of events) {
            expect(event.progress).toBeDefined();
            expect(event.progress.total).toBeGreaterThan(0);
            expect(event.progress.completed).toBeGreaterThanOrEqual(0);
            expect(event.progress.completed).toBeLessThanOrEqual(
              event.progress.total,
            );
            expect(event.progress.label.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: deploy-flow-production-ready, Property 3: ProgressModel.completed is monotonically non-decreasing
describe("Property 3 — monotonically non-decreasing completed", () => {
  it("completed never decreases across successive events", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom("pending", "building", "releasing", "ready", "failed"),
          { minLength: 2, maxLength: 8 },
        ),
        async (states) => {
          // Exclude sequences that contain "failed" followed by a non-terminal state
          // (failed resets completed to 0 which would appear as a decrease)
          const failedIdx = states.indexOf("failed");
          if (failedIdx >= 0 && failedIdx < states.length - 1) return;

          const events = await runWatch(states);

          let lastCompleted = -1;
          for (const event of events) {
            expect(event.progress.completed).toBeGreaterThanOrEqual(
              lastCompleted,
            );
            lastCompleted = event.progress.completed;
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("clamps completed using max(mapped, lastCompleted)", () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom("pending", "building", "releasing"),
          { minLength: 2, maxLength: 6 },
        ),
        async (states) => {
          const events = await runWatch(states);

          let lastCompleted = -1;
          for (const event of events) {
            // The SDK clamps: completed = max(mapped, lastCompleted)
            // So completed should never be less than the previous value
            // when the state is not "failed"
            expect(event.progress.completed).toBeGreaterThanOrEqual(
              lastCompleted,
            );
            lastCompleted = event.progress.completed;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: deploy-flow-production-ready, Property 4: Exponential backoff delay grows with failure count
describe("Property 4 — exponential backoff is non-decreasing", () => {
  it("delay at failure n is always >= delay at failure n-1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 7 }),
        (n) => {
          const delayN = backoffDelay(n, 3000, 30000) as number;
          const delayNminus1 = backoffDelay(
            n - 1,
            3000,
            30000,
          ) as number;
          expect(delayN).toBeGreaterThanOrEqual(delayNminus1);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("delay at failure 0 equals the base delay", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        fc.integer({ min: 5000, max: 60000 }),
        (baseMs, maxMs) => {
          const delay = backoffDelay(
            0,
            baseMs,
            maxMs,
          ) as number;
          expect(delay).toBe(baseMs);
        },
      ),
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
          const delay = backoffDelay(
            failures,
            baseMs,
            maxMs,
          ) as number;
          expect(delay).toBeLessThanOrEqual(maxMs);
        },
      ),
      { numRuns: 100 },
    );
  });
});
