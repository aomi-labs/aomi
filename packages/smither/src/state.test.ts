import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRunState,
  loadPlan,
  loadRunState,
  planPath,
  resetRunState,
  runDir,
  savePlan,
  smitherDbPath,
} from "../state";
import { finalizePlan } from "../plan";

describe("run state", () => {
  it("persists a run pointer and reloads the same runId", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aomi-runs-"));

    const created = await createRunState("demo", root);
    const loaded = await loadRunState("demo", root);

    expect(loaded?.runId).toBe(created.runId);
    expect(created.runId).toMatch(/^smither-demo-/);
    expect(smitherDbPath("demo", root)).toBe(path.join(runDir("demo", root), "smithers.sqlite"));
  });

  it("reset removes the pointer so a fresh run gets a new id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aomi-runs-"));

    const first = await createRunState("demo", root);
    await resetRunState("demo", root);
    expect(await loadRunState("demo", root)).toBeNull();
    const second = await createRunState("demo", root);

    expect(second.runId).not.toBe(first.runId);
  });

  it("sanitizes app names used for run directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aomi-runs-"));
    await createRunState("weird/app name", root);
    expect(await loadRunState("weird/app name", root)).not.toBeNull();
    expect(runDir("weird/app name", root)).toBe(path.join(root, "weird_app_name"));
  });

  it("round-trips the BuildPlan for external observers", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aomi-runs-"));
    const plan = finalizePlan({ app: "demo", sdkRoot: "/tmp/sdk", builder: "none" }).plan;
    expect(plan).not.toBeNull();

    await savePlan(plan!, root);
    const loaded = await loadPlan("demo", root);

    expect(planPath("demo", root)).toBe(path.join(runDir("demo", root), "plan.json"));
    expect(loaded).toEqual(plan);
  });

  it("loadPlan returns null when no plan was persisted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aomi-runs-"));
    expect(await loadPlan("ghost", root)).toBeNull();
  });
});
