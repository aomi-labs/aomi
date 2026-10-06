import { afterEach, describe, expect, it } from "vitest";
import { startIntakeServer, type IntakeServerHandle } from "../intake";
import { buildPlanSchema, stagesFor } from "../plan";

describe("intake server", () => {
  let handle: IntakeServerHandle | null = null;
  afterEach(() => {
    handle?.close();
    handle = null;
  });

  it("serves a self-contained page that polls /intake and follows buildUrl", async () => {
    handle = await startIntakeServer({ app: "demo" });
    const page = await (await fetch(handle.url)).text();
    expect(page).toContain("<!doctype html>");
    expect(page).toContain("/intake");
    // The page must auto-follow to the gateway console when the build starts.
    expect(page).toContain("location.href = state.buildUrl");
    // No external asset except fonts (parity with the branded console).
    expect(page).not.toContain("<script src");
  });

  it("reflects live state and the intake → preview → building transition", async () => {
    handle = await startIntakeServer({ app: "morpho" });
    const read = async () =>
      (await (await fetch(`${handle!.url}intake`)).json()) as Record<string, unknown>;

    let state = await read();
    expect(state.phase).toBe("intake");
    expect(state.turns).toEqual([]);

    handle.update({
      turns: [
        { role: "smither", text: "What do you wanna build?" },
        { role: "user", text: "a morpho pool manager" },
      ],
      draft: { app: "morpho", builder: "claude" },
      thinking: true,
      thinkingSince: 1,
    });
    state = await read();
    expect((state.turns as unknown[]).length).toBe(2);
    expect(state.thinking).toBe(true);

    const plan = buildPlanSchema.parse({
      app: "morpho",
      sdkRoot: "/tmp",
      builder: "none",
      phases: [
        { kind: "agent", id: "research", role: "research" },
        { kind: "agent", id: "synthesize", role: "synthesize" },
      ],
    });
    handle.update({ thinking: false, phase: "preview", stages: stagesFor(plan) });
    state = await read();
    expect(state.phase).toBe("preview");
    expect((state.stages as { id: string }[]).map((s) => s.id)).toEqual([
      "morpho:research",
      "morpho:synthesize",
      "morpho:result",
    ]);

    handle.update({ phase: "building", buildUrl: "http://127.0.0.1:7332/workflows/morpho" });
    state = await read();
    expect(state.phase).toBe("building");
    expect(state.buildUrl).toBe("http://127.0.0.1:7332/workflows/morpho");
  });

  it("picks the next port when the preferred one is taken", async () => {
    handle = await startIntakeServer({ app: "a", port: 7455 });
    const second = await startIntakeServer({ app: "b", port: 7455 });
    try {
      expect(second.port).toBe(handle.port + 1);
    } finally {
      second.close();
    }
  });
});
