import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig } from "./types";

const {
  chatCommandMock,
  openInteractiveChatMock,
  readlineMock,
  modelsCommandMock,
  setAppCommandMock,
  setAgentModeCommandMock,
  setModelCommandMock,
  saveByokKeyCommandMock,
  showByokKeysCommandMock,
  clearByokKeysCommandMock,
} = vi.hoisted(() => ({
  chatCommandMock: vi.fn().mockResolvedValue(undefined),
  openInteractiveChatMock: vi.fn(),
  readlineMock: { question: vi.fn(), close: vi.fn() },
  modelsCommandMock: vi.fn().mockResolvedValue(undefined),
  setAppCommandMock: vi.fn(),
  setAgentModeCommandMock: vi.fn(),
  setModelCommandMock: vi.fn().mockResolvedValue(undefined),
  saveByokKeyCommandMock: vi.fn().mockResolvedValue(undefined),
  showByokKeysCommandMock: vi.fn().mockResolvedValue(undefined),
  clearByokKeysCommandMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./commands/chat", () => ({
  chatCommand: chatCommandMock,
  openInteractiveChat: openInteractiveChatMock,
}));

vi.mock("node:readline/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:readline/promises")>();
  const createInterface = vi.fn(() => readlineMock);
  return {
    ...original,
    createInterface,
    default: { ...original, createInterface },
  };
});

vi.mock("./commands/control", () => ({
  modelsCommand: modelsCommandMock,
  setAppCommand: setAppCommandMock,
  setAgentModeCommand: setAgentModeCommandMock,
  setModelCommand: setModelCommandMock,
}));

vi.mock("./commands/byok", () => ({
  saveByokKeyCommand: saveByokKeyCommandMock,
  showByokKeysCommand: showByokKeysCommandMock,
  clearByokKeysCommand: clearByokKeysCommandMock,
}));

vi.mock("./cli-session", () => ({
  CliSession: {
    loadOrCreate: vi.fn(() => ({ model: "gpt-5-mini" })),
  },
}));

describe("CLI REPL command routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes plain text to chatCommand", async () => {
    const { handleReplLine } = await import("./repl");
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
    const { handleReplLine } = await import("./repl");
    const config: CliConfig = {
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
    const { handleReplLine } = await import("./repl");
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
    const { handleReplLine } = await import("./repl");
    const config: CliConfig = {
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
    const { handleReplLine } = await import("./repl");
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
    const { handleReplLine } = await import("./repl");

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

describe("interactive turn input routing", () => {
  it("uses the persistent session for text, explicit queue, and targeted stop", async () => {
    const { handleReplLine } = await import("./repl");
    const config = { baseUrl: "https://example.test", secrets: {} };
    const interaction = {
      send: vi.fn().mockResolvedValue(undefined),
      queue: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    await handleReplLine(config, "Use 5 instead", false, interaction);
    await handleReplLine(
      config,
      "/queue Research another token",
      false,
      interaction,
    );
    await handleReplLine(config, "/stop queued-turn", false, interaction);
    expect(interaction.send).toHaveBeenCalledWith("Use 5 instead");
    expect(interaction.queue).toHaveBeenCalledWith("Research another token");
    expect(interaction.cancel).toHaveBeenCalledWith("queued-turn");
  });
});

describe("interactive error recovery", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["correct this", "send", "target_terminal"],
    ["another correction", "send", "revision_conflict"],
    ["old host correction", "send", "steering_unsupported"],
    ["/queue separate task", "queue", "queue_full"],
    ["/stop root", "cancel", "network unavailable"],
    ["accepted request", "sync", "sync unavailable"],
  ] as const)("keeps the session open after %s fails", async (line, method, error) => {
    const { runInteractiveCli } = await import("./repl");
    vi.spyOn(process, "stdin", "get").mockReturnValue({
      isTTY: true,
    } as typeof process.stdin);
    vi.spyOn(process, "stdout", "get").mockReturnValue({
      isTTY: true,
    } as typeof process.stdout);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const chat = {
      send: vi.fn().mockResolvedValue(undefined),
      queue: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      sync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    chat[method].mockRejectedValueOnce(new Error(error));
    openInteractiveChatMock.mockResolvedValueOnce(chat);
    readlineMock.question
      .mockReset()
      .mockResolvedValueOnce(line)
      .mockResolvedValueOnce("follow up")
      .mockResolvedValueOnce(":exit");
    readlineMock.close.mockClear();

    await expect(runInteractiveCli({ secrets: {} })).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledExactlyOnceWith(`❌ ${error}`);
    expect(readlineMock.question).toHaveBeenCalledTimes(3);
    expect(chat.send).toHaveBeenLastCalledWith("follow up");
    expect(chat[method]).toHaveBeenCalledTimes(
      method === "send" || method === "sync" ? 2 : 1,
    );
    expect(chat.close).toHaveBeenCalledOnce();
    expect(readlineMock.close).toHaveBeenCalledOnce();
  });
});
