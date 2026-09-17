import { describe, expect, it } from "vitest";
import { normalizeAomiRouting, shouldShowDirectAppSelect } from "./routing";

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

  it("rejects Direct without a target", () => {
    expect(
      normalizeAomiRouting({ targets: [{ mode: "direct", apps: [] }] }).error,
    ).toContain("at least one app");
  });
});

describe("shouldShowDirectAppSelect", () => {
  it("shows the target segment for a selectable Auto/Direct surface", () => {
    const routing = normalizeAomiRouting({
      targets: [
        { mode: "auto" },
        { mode: "direct", apps: [{ app: "uniswap" }] },
      ],
    });

    expect(shouldShowDirectAppSelect("auto", routing)).toBe(false);
    expect(shouldShowDirectAppSelect("direct", routing)).toBe(true);
  });

  it("hides only a host-fixed Direct target", () => {
    const fixed = normalizeAomiRouting({
      targets: [{ mode: "direct", apps: [{ app: "uniswap" }] }],
    });
    const selectable = normalizeAomiRouting({
      targets: [
        {
          mode: "direct",
          apps: [{ app: "uniswap" }, { app: "aave" }],
        },
      ],
    });

    expect(shouldShowDirectAppSelect("direct", fixed)).toBe(false);
    expect(shouldShowDirectAppSelect("direct", selectable)).toBe(true);
  });
});
