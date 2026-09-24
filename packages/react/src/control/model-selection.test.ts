import { describe, expect, it } from "vitest";

import { resolveAutoModel } from "./model-selection";

describe("resolveAutoModel", () => {
  it("uses GPT-6 Sol for Balanced when it is available", () => {
    expect(
      resolveAutoModel(["Claude Haiku 4.5", "GPT-5.6 Terra", "GPT-6 Sol"]),
    ).toBe("GPT-6 Sol");
    expect(resolveAutoModel(["gpt-6-luna", "gpt-6-sol"])).toBe("gpt-6-sol");
  });
});
