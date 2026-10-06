import { describe, expect, it } from "vitest";
import { runEvalStep, evalJudge } from "../evals";
import { buildPlanSchema, evalPhaseSchema } from "../plan";
import type { CommandRunner } from "../types";
import type { ResolvedBinaries } from "../types";

const binaries: ResolvedBinaries = {
  aomiBuild: "/bin/aomi-build",
  aomiRun: "/bin/aomi-run",
  sdkRoot: "/tmp/sdk",
  source: "fresh-cargo-build",
};

const plan = buildPlanSchema.parse({ app: "pools", sdkRoot: "/tmp/sdk", builder: "claude" });
const phase = evalPhaseSchema.parse({
  kind: "eval",
  id: "e",
  scenario: "supply to the best vault",
  rubric: "picks a real vault and explains the APY",
  threshold: 0.7,
});

/** A runner that records calls and returns scripted results by command. */
function scriptedRunner(script: {
  compileExit?: number;
  runOut?: string;
  runExit?: number;
  judgeOut?: string;
  judgeExit?: number;
}): { runner: CommandRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: CommandRunner = async (file, args) => {
    calls.push([file, ...args].join(" "));
    if (args.includes("compile")) {
      return { command: file, exitCode: script.compileExit ?? 0, stdout: "", stderr: "" };
    }
    if (file === "aomi-run" || file === "/bin/aomi-run") {
      return { command: file, exitCode: script.runExit ?? 0, stdout: script.runOut ?? "", stderr: "" };
    }
    // the judge (claude/codex)
    return { command: file, exitCode: script.judgeExit ?? 0, stdout: script.judgeOut ?? "", stderr: "" };
  };
  return { runner, calls };
}

describe("eval judge", () => {
  it("defaults the judge to the builder, or claude when builder is none", () => {
    expect(evalJudge(plan, phase)).toBe("claude");
    expect(evalJudge(buildPlanSchema.parse({ app: "a", sdkRoot: "/t", builder: "codex" }), phase)).toBe("codex");
    expect(evalJudge(buildPlanSchema.parse({ app: "a", sdkRoot: "/t", builder: "none" }), phase)).toBe("claude");
  });

  it("runs compile → scenario → judge and passes when score ≥ threshold", async () => {
    const { runner, calls } = scriptedRunner({
      runOut: "I supplied 100 USDC to the Steakhouse vault at 6.2% APY.",
      judgeOut: '{"score": 0.9, "notes": "named a real vault and the APY"}',
    });
    const result = await runEvalStep({ plan, phase, binaries, runner });
    expect(result.score).toBe(0.9);
    expect(result.pass).toBe(true);
    expect(result.threshold).toBe(0.7);
    expect(result.transcript).toContain("Steakhouse");
    expect(calls.some((c) => c.includes("compile"))).toBe(true);
    expect(calls.some((c) => c.startsWith("/bin/aomi-run"))).toBe(true);
  });

  it("fails when the score is below threshold", async () => {
    const { runner } = scriptedRunner({
      runOut: "I can't do that.",
      judgeOut: 'The transcript is weak.\n{"score": 0.3, "notes": "refused"}',
    });
    const result = await runEvalStep({ plan, phase, binaries, runner });
    expect(result.score).toBe(0.3);
    expect(result.pass).toBe(false);
  });

  it("clamps a malformed / missing score to 0 (a failing eval, not a crash)", async () => {
    const { runner } = scriptedRunner({ runOut: "…", judgeOut: "no json here" });
    const result = await runEvalStep({ plan, phase, binaries, runner });
    expect(result.score).toBe(0);
    expect(result.pass).toBe(false);
  });

  it("throws when the scenario run fails", async () => {
    const { runner } = scriptedRunner({ runExit: 1, runOut: "boom" });
    await expect(runEvalStep({ plan, phase, binaries, runner })).rejects.toThrow(/scenario run failed/);
  });
});
