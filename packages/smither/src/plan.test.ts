import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentSpecsFor,
  buildPlanSchema,
  describePlan,
  finalizePlan,
  mergePlanDraft,
  nodeId,
  stagesFor,
} from "../plan";

const base = { app: "demo", sdkRoot: "/sdk" };

describe("buildPlanSchema", () => {
  it("fills defaults for a minimal plan", () => {
    const plan = buildPlanSchema.parse(base);
    expect(plan.source).toBe("discover");
    expect(plan.builder).toBe("claude");
    expect(plan.maxFixRounds).toBe(2);
    expect(plan.deploy).toBe(false);
    expect(plan.allowStaleSdk).toBe(false);
  });

  it("rejects invalid app names", () => {
    expect(buildPlanSchema.safeParse({ ...base, app: "bad name!" }).success).toBe(false);
  });
});

describe("stagesFor", () => {
  it("composes the minimal pipeline", () => {
    const plan = buildPlanSchema.parse({ ...base, builder: "none" });
    const ids = stagesFor(plan).map((stage) => stage.id);
    expect(ids).toEqual([
      nodeId("demo", "binaries"),
      nodeId("demo", "codegen"),
      nodeId("demo", "validate-loop"),
      nodeId("demo", "result"),
    ]);
  });

  it("mounts agents, review, smoke, and a gated deploy from the plan", () => {
    const plan = buildPlanSchema.parse({
      ...base,
      review: true,
      smoke: true,
      deploy: true,
    });
    const stages = stagesFor(plan);
    const ids = stages.map((stage) => stage.id);
    expect(ids).toContain(nodeId("demo", "curate"));
    expect(ids).toContain(nodeId("demo", "review"));
    expect(ids).toContain(nodeId("demo", "smoke"));
    expect(ids).toContain(nodeId("demo", "deploy-gate"));
    expect(ids).toContain(nodeId("demo", "deploy"));
    expect(stages.find((stage) => stage.id === nodeId("demo", "deploy-gate"))?.kind).toBe(
      "approval",
    );
  });

  it("drops the approval gate when auto-approved", () => {
    const plan = buildPlanSchema.parse({ ...base, deploy: true, autoApprove: true });
    const ids = stagesFor(plan).map((stage) => stage.id);
    expect(ids).toContain(nodeId("demo", "deploy"));
    expect(ids).not.toContain(nodeId("demo", "deploy-gate"));
  });
});

describe("mergePlanDraft", () => {
  it("keeps only schema-valid fields from the agent's patch", () => {
    const merged = mergePlanDraft(base, {
      app: "weather",
      builder: "codex",
      deploy: "yes-please", // invalid type — dropped
      nonsense: true, // unknown key — dropped
    });
    expect(merged.app).toBe("weather");
    expect(merged.builder).toBe("codex");
    expect(merged.deploy).toBeUndefined();
    expect((merged as Record<string, unknown>).nonsense).toBeUndefined();
  });
});

describe("finalizePlan", () => {
  it("reports missing fields as issues instead of throwing", () => {
    const outcome = finalizePlan({ sdkRoot: "/sdk" });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues.join(" ")).toContain("app");
  });

  it("requires openApiUrl when source is url", () => {
    const outcome = finalizePlan({ ...base, source: "url" });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues[0]).toContain("openApiUrl");
  });

  it("produces a describable plan", () => {
    const outcome = finalizePlan({ ...base, deploy: true });
    expect(outcome.plan).not.toBeNull();
    const lines = describePlan(outcome.plan as NonNullable<typeof outcome.plan>);
    expect(lines.join("\n")).toContain("deploy: yes (gated)");
  });
});

describe("composition", () => {
  const base = { app: "demo", sdkRoot: "/tmp/sdk" };

  it("classic composition preserves the pre-composition node ids", () => {
    const plan = buildPlanSchema.parse({
      ...base,
      review: true,
      smoke: true,
      deploy: true,
    });
    expect(stagesFor(plan).map((s) => s.id)).toEqual([
      "demo:binaries",
      "demo:codegen",
      "demo:curate",
      "demo:review",
      "demo:validate-loop",
      "demo:smoke",
      "demo:deploy-gate",
      "demo:deploy",
      "demo:result",
    ]);
  });

  it("guarantees a trailing result phase for custom compositions", () => {
    const plan = buildPlanSchema.parse({
      ...base,
      phases: [
        { kind: "agent", id: "research", role: "research" },
        { kind: "agent", id: "synthesize", role: "synthesize" },
      ],
    });
    const ids = stagesFor(plan).map((s) => s.id);
    expect(ids).toEqual(["demo:research", "demo:synthesize", "demo:result"]);
  });

  it("carries clarify metadata onto the stage rail", () => {
    const plan = buildPlanSchema.parse({
      ...base,
      phases: [
        {
          kind: "clarify",
          id: "spec-path",
          question: "Morpho has no public OpenAPI. How should we proceed?",
          options: [
            { key: "research-mode", label: "Research + preambles" },
            { key: "draft-spec", label: "Draft a spec from docs" },
          ],
        },
        { kind: "agent", id: "research", role: "research" },
      ],
    });
    const clarifyStage = stagesFor(plan).find((s) => s.kind === "clarify");
    expect(clarifyStage?.clarify?.options.map((o) => o.key)).toEqual([
      "research-mode",
      "draft-spec",
    ]);
  });

  it("finalizePlan rejects structurally broken compositions", () => {
    const outcome = finalizePlan({
      ...base,
      phases: [
        { kind: "compute", id: "codegen", op: "codegen" },
        {
          kind: "loop",
          id: "check",
          until: "validation-green",
          maxRounds: 2,
          body: [{ kind: "agent", id: "patch", role: "fix", onlyIf: "prev-red" }],
        },
      ],
    });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues.join(" ")).toMatch(/binaries/);
    expect(outcome.issues.join(" ")).toMatch(/validate/);
  });

  it("accepts a research-mode composition and merges it through drafts", () => {
    const merged = mergePlanDraft(base, {
      phases: [
        { kind: "agent", id: "research", role: "research", brief: "morpho + etherfi" },
        { kind: "agent", id: "synthesize", role: "synthesize" },
        {
          kind: "loop",
          id: "validate-loop",
          until: "validation-green",
          maxRounds: 3,
          body: [
            { kind: "compute", id: "validate", op: "validate" },
            { kind: "agent", id: "fix", role: "fix", onlyIf: "prev-red" },
          ],
        },
      ],
    });
    const outcome = finalizePlan(merged);
    expect(outcome.plan).not.toBeNull();
    expect(outcome.plan?.phases?.length).toBe(3);
  });
});

describe("stage 2 — eval, loops, parallel", () => {
  const base = { app: "pools", sdkRoot: "/tmp/sdk", builder: "claude" as const };

  const defiPools = () =>
    buildPlanSchema.parse({
      ...base,
      userStory: "Manage Morpho + EtherFi positions",
      phases: [
        { kind: "compute", id: "binaries", op: "binaries" },
        {
          kind: "parallel",
          id: "research",
          branches: [
            [{ kind: "agent", id: "research-morpho", role: "research", brief: "morpho" }],
            [{ kind: "agent", id: "research-etherfi", role: "research", brief: "etherfi" }],
          ],
        },
        { kind: "agent", id: "synthesize", role: "synthesize" },
        {
          kind: "loop",
          id: "behavior-loop",
          until: "eval-pass",
          onMax: "return-last",
          maxRounds: 3,
          body: [
            { kind: "eval", id: "behavior-eval", scenario: "supply to the best vault", rubric: "picks a real vault", threshold: 0.7 },
            { kind: "agent", id: "refine", role: "synthesize", onlyIf: "prev-eval-fail" },
          ],
        },
      ],
    });

  it("composes the defi-pools program (parallel research → synthesize → eval loop)", () => {
    const stages = stagesFor(defiPools());
    // parallel emits a header row plus one row per branch leaf.
    expect(stages.map((s) => s.id)).toEqual([
      "pools:binaries",
      "pools:research",
      "pools:research-morpho",
      "pools:research-etherfi",
      "pools:synthesize",
      "pools:behavior-loop",
      "pools:result",
    ]);
    const parallelHeader = stages.find((s) => s.id === "pools:research");
    expect(parallelHeader?.kind).toBe("parallel");
    expect(stages.find((s) => s.id === "pools:research-morpho")?.branchOf).toBe("research");
    expect(stages.find((s) => s.id === "pools:behavior-loop")?.kind).toBe("loop");
  });

  it("accepts the defi-pools composition through finalize", () => {
    const outcome = finalizePlan(defiPools());
    expect(outcome.plan).not.toBeNull();
    expect(outcome.issues).toEqual([]);
  });

  it("rejects an eval-pass loop with no eval phase in its body", () => {
    const outcome = finalizePlan({
      ...base,
      phases: [
        { kind: "compute", id: "binaries", op: "binaries" },
        {
          kind: "loop",
          id: "bad",
          until: "eval-pass",
          maxRounds: 2,
          body: [{ kind: "agent", id: "refine", role: "synthesize" }],
        },
      ],
    });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues.join(" ")).toMatch(/eval-pass.*no "eval"/);
  });

  it("rejects an eval phase with no binaries before it", () => {
    const outcome = finalizePlan({
      ...base,
      phases: [
        { kind: "eval", id: "e", scenario: "x", rubric: "y", threshold: 0.5 },
        { kind: "compute", id: "binaries", op: "binaries" },
      ],
    });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues.join(" ")).toMatch(/"eval" needs a "binaries"/);
  });

  it("flags duplicate ids across parallel branches", () => {
    const outcome = finalizePlan({
      ...base,
      phases: [
        { kind: "compute", id: "binaries", op: "binaries" },
        {
          kind: "parallel",
          id: "p",
          branches: [
            [{ kind: "agent", id: "dup", role: "research" }],
            [{ kind: "agent", id: "dup", role: "research" }],
          ],
        },
      ],
    });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues.join(" ")).toMatch(/duplicate id "dup"/);
  });
});

describe("stage 3 — wait-external + cross-repo agents", () => {
  const base = { app: "gamefi", sdkRoot: "/tmp/sdk", builder: "claude" as const };

  const gamefi = () =>
    buildPlanSchema.parse({
      ...base,
      userStory: "A GameFi companion around the player's game + on-chain state",
      phases: [
        { kind: "agent", id: "design-apis", role: "design", repo: "/tmp/game-engine", brief: "companion endpoints" },
        { kind: "gate", id: "review-design", title: "Approve the proposed game-server APIs?" },
        { kind: "wait-external", id: "await-apis", waitingFor: "the game server ships the APIs", timeoutHours: 168 },
        { kind: "compute", id: "binaries", op: "binaries" },
        { kind: "compute", id: "codegen", op: "codegen" },
        { kind: "agent", id: "curate", role: "curate" },
        { kind: "eval", id: "integration", scenario: "ask about my loadout", rubric: "calls the game API", threshold: 0.7 },
      ],
    });

  it("composes the GameFi cross-stack shape (design → gate → wait-external → build → eval)", () => {
    const stages = stagesFor(gamefi());
    expect(stages.map((s) => s.id)).toEqual([
      "gamefi:design-apis",
      "gamefi:review-design",
      "gamefi:await-apis",
      "gamefi:binaries",
      "gamefi:codegen",
      "gamefi:curate",
      "gamefi:integration",
      "gamefi:result",
    ]);
    expect(stages.find((s) => s.id === "gamefi:await-apis")?.kind).toBe("wait-external");
    expect(stages.find((s) => s.id === "gamefi:await-apis")?.label).toMatch(/game server ships/);
  });

  it("accepts the GameFi composition through finalize", () => {
    expect(finalizePlan(gamefi()).plan).not.toBeNull();
  });

  it("gives a cross-repo design agent a cwd separate from SDK-checkout agents", () => {
    const specs = agentSpecsFor(gamefi());
    const cwds = specs.map((s) => s.cwd).sort();
    // one claude in the game-engine repo (design), one in the SDK (curate).
    expect(cwds).toContain(path.resolve("/tmp/game-engine"));
    expect(cwds).toContain("/tmp/sdk");
    expect(new Set(cwds).size).toBe(2);
  });

  it("collapses same-repo same-agent phases into one instance", () => {
    const plan = buildPlanSchema.parse({
      ...base,
      phases: [
        { kind: "compute", id: "binaries", op: "binaries" },
        { kind: "compute", id: "codegen", op: "codegen" },
        { kind: "agent", id: "curate", role: "curate" },
        { kind: "agent", id: "review", role: "review", agent: "claude" },
      ],
    });
    // curate + review both claude in the SDK checkout → a single instance.
    expect(agentSpecsFor(plan)).toEqual([{ name: "claude", cwd: "/tmp/sdk" }]);
  });
});
