import { describe, expect, it } from "vitest";
import { modelLabel } from "./model-metadata";

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
