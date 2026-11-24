import { describe, expect, it } from "vitest";
import { fromBaseUnits } from "./rules-model";

describe("rules amounts", () => {
  it("converts human amounts with string math, past 2^53", () => {
    expect(fromBaseUnits("500000000", 9)).toBe("0.5");
    expect(fromBaseUnits("12345678901234567890000000000000000001", 18)).toBe(
      "12345678901234567890.000000000000000001",
    );
    expect(fromBaseUnits("0", 6)).toBe("0");
  });
});
