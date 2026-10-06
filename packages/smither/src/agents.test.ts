import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_BASE_URL,
  openrouterAgentEnv,
  resolveAgentBilling,
} from "../agents";

describe("resolveAgentBilling", () => {
  it("defaults to openrouter when its key is present, even alongside the anthropic key", () => {
    expect(
      resolveAgentBilling({
        SMITHER_OPENROUTER_API_KEY: "sk-or-key",
        SMITHER_ANTHROPIC_API_KEY: "sk-ant-key",
      } as NodeJS.ProcessEnv),
    ).toEqual({
      kind: "openrouter",
      apiKey: "sk-or-key",
      model: DEFAULT_OPENROUTER_MODEL,
    });
  });

  it("honors the model override", () => {
    expect(
      resolveAgentBilling({
        SMITHER_OPENROUTER_API_KEY: "sk-or-key",
        SMITHER_OPENROUTER_MODEL: "moonshotai/kimi-k3",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({ model: "moonshotai/kimi-k3" });
  });

  it("falls back to anthropic billing when only that key is set", () => {
    expect(
      resolveAgentBilling({
        SMITHER_ANTHROPIC_API_KEY: "sk-ant-key",
      } as NodeJS.ProcessEnv),
    ).toEqual({ kind: "anthropic", apiKey: "sk-ant-key" });
  });

  it("resolves none for empty env — local CLI login pays", () => {
    expect(resolveAgentBilling({} as NodeJS.ProcessEnv)).toEqual({ kind: "none" });
    expect(resolveAgentBilling(undefined)).toEqual({ kind: "none" });
  });

  it("ignores blank keys", () => {
    expect(
      resolveAgentBilling({
        SMITHER_OPENROUTER_API_KEY: "",
        SMITHER_ANTHROPIC_API_KEY: "",
      } as NodeJS.ProcessEnv),
    ).toEqual({ kind: "none" });
  });
});

describe("openrouterAgentEnv", () => {
  it("points the claude CLI at OpenRouter and pins ANTHROPIC_API_KEY empty", () => {
    const env = openrouterAgentEnv({ apiKey: "sk-or-key", model: "moonshotai/kimi-k2.7-code" });
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: OPENROUTER_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: "sk-or-key",
      // "" (not absent): the CLI must never fall back to first-party auth.
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "moonshotai/kimi-k2.7-code",
      ANTHROPIC_SMALL_FAST_MODEL: "moonshotai/kimi-k2.7-code",
    });
  });
});
