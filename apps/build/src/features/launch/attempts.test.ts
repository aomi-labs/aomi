import { describe, expect, it } from "vitest";
import {
  attemptLabel,
  attemptJobLabel,
  attemptStages,
  type ProjectDeploymentAttempt,
} from "./attempts";
const job = (
  name: string,
  conclusion: string | null,
  status = "completed",
) => ({ id: Math.random(), name, conclusion, status, steps: [] });
const attempt = (
  jobs: ProjectDeploymentAttempt["jobs"],
  conclusion = "success",
) =>
  ({
    id: 1,
    status: "completed",
    conclusion,
    createdAt: "2026-09-07T00:00:00Z",
    jobs,
  }) as ProjectDeploymentAttempt;
describe("deployment stage truth", () => {
  it("does not call a successful build live", () => {
    expect(
      attemptLabel(
        attempt([
          job("Build / demo", "success"),
          job("Publish release", "success"),
        ]),
      ),
    ).toBe("Ready to promote");
  });
  it("omits unrequested activation stages and normalizes unresolved matrix labels", () => {
    const ready = attempt([
      job("Publish release", "success"),
      job("Activate", "skipped"),
      job("Verify runtime / ${{ matrix.name }}", "skipped"),
    ]);
    expect(attemptLabel(ready)).toBe("Ready to promote");
    expect(attemptStages(ready).map((stage) => stage.name)).not.toContain(
      "Verify runtime",
    );
    expect(attemptJobLabel("Verify runtime / ${{ matrix.name }}")).toBe(
      "Verify runtime",
    );
  });
  it("requires all runtime checks to pass", () => {
    const partial = attempt(
      [
        job("Verify runtime / one", "success"),
        job("Verify runtime / two", "failure"),
      ],
      "failure",
    );
    expect(attemptLabel(partial)).toBe("Verify runtime failed");
    expect(attemptStages(partial).at(-1)?.state).toBe("waiting");
    expect(
      attemptLabel(
        attempt([
          job("Verify runtime / one", "success"),
          job("Verify runtime / two", "success"),
        ]),
      ),
    ).toBe("Live");
  });
  it("keeps the failed stage while other apps are still building", () => {
    const running = {
      ...attempt(
        [
          job("Build / broken", "failure"),
          job("Build / pending", null, "in_progress"),
        ],
        "failure",
      ),
      status: "in_progress",
    };
    expect(attemptLabel(running)).toBe("Build failed");
  });
});
