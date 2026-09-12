import { describe, expect, it } from "vitest";

import { resolveAutoModel } from "./model-selection";

describe("resolveAutoModel", () => {
  it("prefers GPT-5.6 Terra over the previous Haiku default", () => {
    expect(
      resolveAutoModel(["Claude Haiku 4.5", "GPT-5.6 Terra", "Gemini 3 Flash"]),
    ).toBe("GPT-5.6 Terra");
  });
});
