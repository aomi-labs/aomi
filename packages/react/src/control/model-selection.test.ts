import { describe, expect, it } from "vitest";

import { resolveAutoModel } from "./model-selection";

describe("resolveAutoModel", () => {
  it("prefers GPT-6.1 Sol over GPT-6 Sol regardless of catalog order", () => {
    expect(
      resolveAutoModel(["GPT-6 Sol", "Claude Haiku 4.5", "GPT-6.1 Sol"]),
    ).toBe("GPT-6.1 Sol");
    expect(resolveAutoModel(["gpt-6-sol", "gpt-6.1-sol", "gpt-6-luna"])).toBe(
      "gpt-6.1-sol",
    );
  });

  it("uses GPT-6 Sol for Balanced when it is available", () => {
    expect(
      resolveAutoModel(["Claude Haiku 4.5", "GPT-5.6 Terra", "GPT-6 Sol"]),
    ).toBe("GPT-6 Sol");
    expect(resolveAutoModel(["gpt-6-luna", "gpt-6-sol"])).toBe("gpt-6-sol");
  });

  it("keeps existing fallbacks when GPT-6.1 Sol is unavailable", () => {
    expect(resolveAutoModel(["kimi-k3", "gemini-3-flash"])).toBe(
      "gemini-3-flash",
    );
    expect(resolveAutoModel(["custom-model", "other-model"])).toBe(
      "custom-model",
    );
    expect(resolveAutoModel([])).toBeNull();
  });
});
