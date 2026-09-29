import { describe, expect, it } from "vitest";
import { normalizeAomiRouting } from "./routing";

describe("normalizeAomiRouting", () => {
  it("defaults an unconfigured widget to Auto only", () => {
    expect(normalizeAomiRouting()).toEqual({
      modes: ["auto"],
      directApps: [],
      defaultMode: "auto",
      error: null,
    });
  });

  it("defaults an Auto and Direct host to Auto", () => {
    expect(
      normalizeAomiRouting({
        targets: [
          { mode: "direct", apps: [{ app: "uniswap" }] },
          { mode: "auto" },
        ],
      }),
    ).toMatchObject({ modes: ["auto", "direct"], defaultMode: "auto" });
  });

  it("supports a fixed Direct-only target", () => {
    expect(
      normalizeAomiRouting({
        targets: [{ mode: "direct", apps: [{ applicationId: 42 }] }],
      }),
    ).toMatchObject({
      modes: ["direct"],
      directApps: [{ applicationId: 42 }],
      defaultMode: "direct",
      error: null,
    });
  });

  it("honors a host Direct default alongside Auto", () => {
    expect(
      normalizeAomiRouting({
        targets: [
          { mode: "auto" },
          { mode: "direct", apps: [{ app: "uniswap" }] },
        ],
        defaultMode: "direct",
      }),
    ).toMatchObject({ defaultMode: "direct", error: null });
  });

  it("rejects Direct without a target", () => {
    expect(
      normalizeAomiRouting({ targets: [{ mode: "direct", apps: [] }] }).error,
    ).toContain("at least one app");
  });
});
