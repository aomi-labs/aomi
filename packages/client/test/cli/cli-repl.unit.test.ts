import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  chatCommandMock,
  modelsCommandMock,
  setAppCommandMock,
  setAgentModeCommandMock,
  setModelCommandMock,
  saveByokKeyCommandMock,
  showByokKeysCommandMock,
  clearByokKeysCommandMock,
} = vi.hoisted(() => ({
  chatCommandMock: vi.fn().mockResolvedValue(undefined),
  modelsCommandMock: vi.fn().mockResolvedValue(undefined),
  setAppCommandMock: vi.fn(),
  setAgentModeCommandMock: vi.fn(),
  setModelCommandMock: vi.fn().mockResolvedValue(undefined),
  saveByokKeyCommandMock: vi.fn().mockResolvedValue(undefined),
  showByokKeysCommandMock: vi.fn().mockResolvedValue(undefined),
  clearByokKeysCommandMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/cli/commands/chat", () => ({
  chatCommand: chatCommandMock,
}));

vi.mock("../../src/cli/commands/control", () => ({
  modelsCommand: modelsCommandMock,
  setAppCommand: setAppCommandMock,
  setAgentModeCommand: setAgentModeCommandMock,
  setModelCommand: setModelCommandMock,
}));

vi.mock("../../src/cli/commands/byok", () => ({
  saveByokKeyCommand: saveByokKeyCommandMock,
  showByokKeysCommand: showByokKeysCommandMock,
  clearByokKeysCommand: clearByokKeysCommandMock,
}));

vi.mock("../../src/cli/cli-session", () => ({
  CliSession: {
    loadOrCreate: vi.fn(() => ({ model: "gpt-5-mini" })),
  },
}));

describe("CLI REPL command routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes plain text to chatCommand", async () => {
    const { handleReplLine } = await import("../../src/cli/repl");
    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      secrets: {},
    };

    await expect(handleReplLine(config, "hello", true)).resolves.toBe(
      "continue",
    );
    expect(chatCommandMock).toHaveBeenCalledWith(config, "hello", true);
  });

  it("updates the current app when /app is used", async () => {
    const { handleReplLine } = await import("../../src/cli/repl");
    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      applicationId: "42",
      secrets: {},
    };

    await handleReplLine(config, "/app khalani", false);

    expect(setAppCommandMock).toHaveBeenCalledWith(config, "khalani", {
      printLocation: false,
    });
    expect(config.app).toBe("khalani");
    expect(config.applicationId).toBeUndefined();
    expect(config.agentMode).toBe("direct");
  });

  it("updates routing with /mode and clears Direct state for Auto", async () => {
    const { handleReplLine } = await import("../../src/cli/repl");
    const config = {
      baseUrl: "https://api.aomi.dev",
      agentMode: "direct" as const,
      app: "khalani",
      applicationId: "42",
      secrets: {},
    };

    await handleReplLine(config, "/mode auto", false);
    expect(setAgentModeCommandMock).toHaveBeenCalledWith(
      config,
      "auto",
      undefined,
      { printLocation: false },
    );
    expect(config.agentMode).toBe("auto");
    expect(config.app).toBeUndefined();
    expect(config.applicationId).toBeUndefined();

    await handleReplLine(config, "/mode direct zerox", false);
    expect(setAgentModeCommandMock).toHaveBeenLastCalledWith(
      config,
      "direct",
      "zerox",
      { printLocation: false },
    );
    expect(config.agentMode).toBe("direct");
    expect(config.app).toBe("zerox");

    await handleReplLine(config, "/mode direct", false);
    expect(config.agentMode).toBe("direct");
    expect(config.app).toBeUndefined();
    expect(config.applicationId).toBeUndefined();
  });

  it("routes /model list and /model <rig>", async () => {
    const { handleReplLine } = await import("../../src/cli/repl");
    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      secrets: {},
    };

    await handleReplLine(config, "/model list", false);
    expect(modelsCommandMock).toHaveBeenCalledWith(config);

    await handleReplLine(config, "/model gpt-5", false);
    expect(setModelCommandMock).toHaveBeenCalledWith(config, "gpt-5", {
      printLocation: false,
    });
    expect(config.model).toBe("gpt-5");
  });

  it("routes /key commands to BYOK-key handlers", async () => {
    const { handleReplLine } = await import("../../src/cli/repl");
    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      secrets: {},
    };

    await handleReplLine(config, "/key anthropic:sk-ant", false);
    expect(saveByokKeyCommandMock).toHaveBeenCalledWith(
      config,
      "anthropic:sk-ant",
      { printLocation: false },
    );

    await handleReplLine(config, "/key show", false);
    expect(showByokKeysCommandMock).toHaveBeenCalledWith(config, {
      printLocation: false,
    });

    await handleReplLine(config, "/key clear", false);
    expect(clearByokKeysCommandMock).toHaveBeenCalledWith(config, {
      printLocation: false,
    });
  });

  it("exits on :exit", async () => {
    const { handleReplLine } = await import("../../src/cli/repl");

    await expect(
      handleReplLine(
        {
          baseUrl: "https://api.aomi.dev",
          app: "default",
          secrets: {},
        },
        ":exit",
        false,
      ),
    ).resolves.toBe("exit");
  });
});
