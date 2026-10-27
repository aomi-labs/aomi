import { describe, expect, it } from "vitest";
import {
  getVendorForModel,
  groupModelsByVendor,
  modelLabel,
} from "./model-metadata";

describe("modelLabel", () => {
  it("reads the backend's supplier routes as model names", () => {
    expect(
      [
        "openai:gpt-6.1-sol",
        "openai:gpt-6-luna",
        "anthropic:claude-opus-5-5",
        "anthropic:claude-sonnet-5-5",
        "openrouter:google/gemini-3-flash-preview",
        "openrouter:moonshotai/kimi-k2.6",
        "openrouter:deepseek/deepseek-v4-pro",
        "openrouter:~deepseek/deepseek-v4-flash-latest",
        "openrouter:z-ai/glm-5.2",
      ].map(modelLabel),
    ).toEqual([
      "GPT-6.1 Sol",
      "GPT-6 Luna",
      "Claude Opus 5.5",
      "Claude Sonnet 5.5",
      "Gemini 3 Flash Preview",
      "Kimi K2.6",
      "DeepSeek V4 Pro",
      "DeepSeek V4 Flash",
      "GLM-5.2",
    ]);
  });

  it("leaves a bare model name readable", () => {
    expect(modelLabel("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
  });
});

describe("model vendors", () => {
  it.each([
    ["openrouter:~deepseek/deepseek-v4-flash-latest", "deepseek"],
    ["openrouter:deepseek/deepseek-v4.1-flash-1017", "deepseek"],
    ["blockrun:deepseek/deepseek-v4.1-flash", "deepseek"],
    ["openrouter:deepseek/deepseek-v4-pro", "deepseek"],
    ["openrouter:moonshotai/kimi-k3", "moonshot"],
    ["openrouter:google/gemini-3-flash-preview", "google"],
    ["openrouter:z-ai/glm-5.2", "glm"],
    ["openai:gpt-6.1-terra", "openai"],
  ])("groups %s under %s", (id, vendor) => {
    expect(getVendorForModel(id).id).toBe(vendor);
  });

  it("keeps Flash and Pro in one DeepSeek group with their original selection ids", () => {
    const models = [
      "openrouter:deepseek/deepseek-v4-pro",
      "openrouter:deepseek/deepseek-v4.1-flash-1017",
    ];
    const groups = groupModelsByVendor(models);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.vendor).toMatchObject({
      id: "deepseek",
      label: "DeepSeek",
    });
    expect(groups[0]?.models).toEqual(expect.arrayContaining(models));
    expect(modelLabel("openai:gpt-6.1-terra")).toBe("GPT-6.1 Terra");
    expect(modelLabel(models[1]!)).toBe("DeepSeek V4.1 Flash");
    expect(modelLabel("blockrun:deepseek/deepseek-v4.1-flash")).toBe(
      "DeepSeek V4.1 Flash",
    );
  });
});
