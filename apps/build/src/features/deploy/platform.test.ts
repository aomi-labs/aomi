import { beforeEach, describe, expect, it } from "vitest";

import {
  platformParam,
  readPlatform,
  writePlatform,
} from "./platform";

describe("platformParam", () => {
  it("trims, and defaults absent or repeated params to Community", () => {
    expect(platformParam("  somm.finance ")).toBe("somm.finance");
    // Build has no unscoped view: no usable param means the default platform.
    expect(platformParam(undefined)).toBe("community");
    expect(platformParam("")).toBe("community");
    expect(platformParam("   ")).toBe("community");
    // Next hands back an array when a param repeats; there is no single
    // platform to honour, so scope falls back to Community.
    expect(platformParam(["a", "b"])).toBe("community");
  });
});

describe("platform storage", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips a selection and clears it", () => {
    expect(readPlatform()).toBeNull();
    writePlatform("  somm.finance  ");
    expect(readPlatform()).toBe("somm.finance");
    writePlatform(null);
    expect(readPlatform()).toBeNull();
  });

  it("treats a blank selection as none", () => {
    writePlatform("   ");
    expect(readPlatform()).toBeNull();
  });
});
