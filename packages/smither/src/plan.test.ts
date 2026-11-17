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
} from "./plan";

const base = { packageName: "demo", sdkRoot: "/sdk" };

describe("buildPlanSchema", () => {
  it("fills defaults for a minimal plan", () => {
    const plan = buildPlanSchema.parse(base);
    expect(plan.source).toBe("discover");
    expect(plan.builder).toBe("claude");
    expect(plan.maxFixRounds).toBe(2);
    expect(plan.allowStaleSdk).toBe(false);
  });

  it("rejects invalid package names", () => {
    expect(
      buildPlanSchema.safeParse({ ...base, packageName: "bad name!" }).success,
    ).toBe(false);
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
});

describe("mergePlanDraft", () => {
  it("keeps only schema-valid fields from the agent's patch", () => {
    const merged = mergePlanDraft(base, {
      packageName: "weather",
      builder: "codex",
      build: "yes-please", // invalid type — dropped
      nonsense: true, // unknown key — dropped
    });
    expect(merged.packageName).toBe("weather");
    expect(merged.builder).toBe("codex");
    expect(merged.build).toBeUndefined();
    expect((merged as Record<string, unknown>).nonsense).toBeUndefined();
  });
});

describe("finalizePlan", () => {
  it("reports missing fields as issues instead of throwing", () => {
    const outcome = finalizePlan({ sdkRoot: "/sdk" });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues.join(" ")).toContain("package");
  });

  it("requires openApiUrl when source is url", () => {
    const outcome = finalizePlan({ ...base, source: "url" });
    expect(outcome.plan).toBeNull();
    expect(outcome.issues[0]).toContain("openApiUrl");
  });
});

describe("composition", () => {
  const base = { packageName: "demo", sdkRoot: "/tmp/sdk" };

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
          body: [
            { kind: "agent", id: "patch", role: "fix", onlyIf: "prev-red" },
          ],
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
        {
          kind: "agent",
          id: "research",
          role: "research",
          brief: "morpho + etherfi",
        },
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

describe("validation loops and parallel research", () => {
  const base = {
    packageName: "pools",
    sdkRoot: "/tmp/sdk",
    builder: "claude" as const,
  };

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
            [
              {
                kind: "agent",
                id: "research-morpho",
                role: "research",
                brief: "morpho",
              },
            ],
            [
              {
                kind: "agent",
                id: "research-etherfi",
                role: "research",
                brief: "etherfi",
              },
            ],
          ],
        },
        { kind: "agent", id: "synthesize", role: "synthesize" },
        {
          kind: "loop",
          id: "behavior-loop",
          until: "validation-green",
          onMax: "return-last",
          maxRounds: 3,
          body: [
            { kind: "compute", id: "validate", op: "validate" },
            {
              kind: "agent",
              id: "refine",
              role: "synthesize",
              onlyIf: "prev-red",
            },
          ],
        },
      ],
    });

  it("composes the defi-pools program (parallel research → synthesize → validation loop)", () => {
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
    expect(stages.find((s) => s.id === "pools:research-morpho")?.branchOf).toBe(
      "research",
    );
    expect(stages.find((s) => s.id === "pools:behavior-loop")?.kind).toBe(
      "loop",
    );
  });

  it("accepts the defi-pools composition through finalize", () => {
    const outcome = finalizePlan(defiPools());
    expect(outcome.plan).not.toBeNull();
    expect(outcome.issues).toEqual([]);
  });

  it("rejects unsupported phase kinds", () => {
    expect(
      buildPlanSchema.safeParse({
        ...base,
        phases: [{ kind: "unsupported", id: "unsupported" }],
      }).success,
    ).toBe(false);
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
  const base = {
    packageName: "gamefi",
    sdkRoot: "/tmp/sdk",
    builder: "claude" as const,
  };

  const gamefi = () =>
    buildPlanSchema.parse({
      ...base,
      userStory: "A GameFi companion around the player's game + on-chain state",
      phases: [
        {
          kind: "agent",
          id: "design-apis",
          role: "design",
          repo: "/tmp/game-engine",
          brief: "companion endpoints",
        },
        {
          kind: "gate",
          id: "review-design",
          title: "Approve the proposed game-server APIs?",
        },
        {
          kind: "wait-external",
          id: "await-apis",
          waitingFor: "the game server ships the APIs",
          timeoutHours: 168,
        },
        { kind: "compute", id: "binaries", op: "binaries" },
        { kind: "compute", id: "codegen", op: "codegen" },
        { kind: "agent", id: "curate", role: "curate" },
        { kind: "compute", id: "integration", op: "validate" },
      ],
    });

  it("composes the GameFi cross-stack shape (design → gate → wait-external → build → validate)", () => {
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
    expect(stages.find((s) => s.id === "gamefi:await-apis")?.kind).toBe(
      "wait-external",
    );
    expect(stages.find((s) => s.id === "gamefi:await-apis")?.label).toMatch(
      /game server ships/,
    );
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
