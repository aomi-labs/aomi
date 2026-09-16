import { describe, expect, it } from "vitest";
import { getAppInfo, groupAppsByCategory } from "./app-metadata";

describe("app-metadata", () => {
  it("handles non-string app ids without throwing", () => {
    const apps = [
      "default",
      undefined,
      null,
      123,
      "binance",
    ] as unknown as string[];

    expect(() => groupAppsByCategory(apps)).not.toThrow();

    const grouped = groupAppsByCategory(apps);
    const allIds = grouped.flatMap((group) => group.apps.map((app) => app.id));
    expect(allIds).toEqual(expect.arrayContaining(["binance", "default"]));
    expect(allIds).toHaveLength(2);
  });

  it("returns fallback metadata for empty app id", () => {
    const info = getAppInfo("" as unknown as string);
    expect(info.displayName).toBe("Unknown App");
    expect(info.abbr).toBe("?");
  });

  it("labels the default as Basic", () => {
    expect(getAppInfo("default")).toMatchObject({
      displayName: "Basic",
      abbr: "B",
    });
  });

  it("describes the orchestrator as a mode that sorts above individual apps", () => {
    const info = getAppInfo("orchestrator");

    expect(info).toMatchObject({
      id: "orchestrator",
      displayName: "Orchestrator",
      abbr: "Or",
    });
    expect(info.category).toEqual({ id: "modes", label: "Modes", order: 5 });

    const grouped = groupAppsByCategory(["binance", "orchestrator"]);
    expect(grouped.map((group) => group.category.id)).toEqual(["modes", "cex"]);
  });

  it("preserves hosted application ids while grouping", () => {
    const grouped = groupAppsByCategory([
      { name: "partner-agent", applicationId: 42 },
    ]);

    expect(grouped[0]?.apps[0]).toMatchObject({
      id: "partner-agent",
      displayName: "Partner Agent",
      applicationId: 42,
    });
  });
});
