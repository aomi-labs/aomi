import { describe, expect, it } from "vitest";
import { distillIntent } from "../intent";
import { extractJsonObject } from "../prompts";
import type { CommandRunner } from "../types";

describe("extractJsonObject", () => {
  it("parses bare JSON", () => {
    expect(extractJsonObject('{"ready": true}')).toEqual({ ready: true });
  });

  it("digs JSON out of prose and fences", () => {
    const raw = 'Sure! Here is the plan:\n```json\n{"summary": "a weather app", "ready": false}\n```\nLet me know.';
    expect(extractJsonObject(raw)).toEqual({ summary: "a weather app", ready: false });
  });

  it("returns undefined when there is no JSON", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
  });
});

describe("distillIntent", () => {
  it("runs the intent agent read-only and validates the draft", async () => {
    const calls: { file: string; args: string[] }[] = [];
    const runner: CommandRunner = async (file, args) => {
      calls.push({ file, args });
      return {
        exitCode: 0,
        stdout:
          'Analysis done.\n{"summary": "weather app from open-meteo", "plan": {"app": "weather", "source": "url", "openApiUrl": "https://api.open-meteo.com/openapi.json"}, "questions": ["Deploy after validation?"], "ready": false}',
        stderr: "",
      };
    };

    const draft = await distillIntent({
      turns: [{ role: "user", text: "an app for open-meteo weather" }],
      draft: { sdkRoot: "/sdk" },
      sdkRoot: "/sdk",
      agent: "codex",
      runner,
    });

    expect(calls[0].file).toBe("codex");
    expect(calls[0].args).toContain("--sandbox");
    expect(calls[0].args).toContain("read-only");
    expect(draft.plan.app).toBe("weather");
    expect(draft.questions).toHaveLength(1);
    expect(draft.ready).toBe(false);
  });

  it("surfaces unparseable agent output as an error", async () => {
    const runner: CommandRunner = async () => ({
      exitCode: 0,
      stdout: "I could not decide.",
      stderr: "",
    });
    await expect(
      distillIntent({
        turns: [{ role: "user", text: "?" }],
        draft: {},
        sdkRoot: "/sdk",
        runner,
      }),
    ).rejects.toThrow(/could not parse intent JSON/);
  });
});
