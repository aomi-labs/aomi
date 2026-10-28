import { describe, expect, it } from "vitest";

import { resolveAutoModel, resolveCatalogModel } from "./model-selection";

describe("saved model selections", () => {
  it.each([
    ["openrouter:openai/gpt-6-luna", "openai:gpt-6-luna"],
    ["blockrun:openai/gpt-6-luna", "openai:gpt-6-luna"],
    ["gpt-6-luna", "openai:gpt-6-luna"],
    ["openrouter:anthropic/claude-opus-5.5", "anthropic:claude-opus-5-5"],
    ["openrouter:anthropic/claude-sonnet-5.5", "anthropic:claude-sonnet-5-5"],
  ])("recovers %s as the catalog's %s", (saved, current) => {
    expect(resolveCatalogModel(saved, ["openai:gpt-6.1-sol", current])).toBe(
      current,
    );
  });

  it("does not confuse different model versions or invent unavailable choices", () => {
    const models = ["openai:gpt-6.1-sol", "openai:gpt-6-sol"];
    expect(
      resolveCatalogModel("openrouter:openai/gpt-6-luna", models),
    ).toBeNull();
    expect(resolveCatalogModel(null, models)).toBeNull();
    expect(resolveCatalogModel("openai:gpt-6-luna", [])).toBeNull();
  });

  it("keeps an exact catalog match", () => {
    expect(resolveCatalogModel("custom:model", ["custom:model"])).toBe(
      "custom:model",
    );
  });
});

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
