import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliExit } from "../../src/cli/errors";

const {
  listByokKeysMock,
  saveByokKeyMock,
  deleteByokKeyMock,
  loadOrCreateMock,
  ensureClientIdMock,
} = vi.hoisted(() => ({
  listByokKeysMock: vi.fn().mockResolvedValue([]),
  saveByokKeyMock: vi.fn().mockResolvedValue({
    provider: "anthropic",
    key_prefix: "sk-ant-",
    label: null,
    is_active: true,
  }),
  deleteByokKeyMock: vi.fn().mockResolvedValue(true),
  ensureClientIdMock: vi.fn(() => "client-1"),
  loadOrCreateMock: vi.fn(),
}));

vi.mock("../../src/client", () => ({
  AomiClient: vi.fn(() => ({
    listByokKeys: listByokKeysMock,
    saveByokKey: saveByokKeyMock,
    deleteByokKey: deleteByokKeyMock,
  })),
}));

vi.mock("../../src/cli/cli-session", () => ({
  CliSession: {
    loadOrCreate: loadOrCreateMock,
  },
}));

describe("CLI BYOK-key commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOrCreateMock.mockReturnValue({
      baseUrl: "https://api.aomi.dev",
      apiKey: undefined,
      sessionId: "session-1",
      ensureClientId: ensureClientIdMock,
    });
    listByokKeysMock.mockResolvedValue([]);
    saveByokKeyMock.mockResolvedValue({
      provider: "anthropic",
      key_prefix: "sk-ant-",
      label: null,
      is_active: true,
    });
    deleteByokKeyMock.mockResolvedValue(true);
  });

  it("saves a BYOK key for the active Agent account", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { saveByokKeyCommand } = await import("../../src/cli/commands/byok");

    await saveByokKeyCommand(
      {
        baseUrl: "https://api.aomi.dev",
        app: "default",
        secrets: {},
      },
      "anthropic:sk-ant-test",
      { printLocation: false },
    );

    expect(saveByokKeyMock).toHaveBeenCalledWith(
      "session-1",
      "anthropic",
      "sk-ant-test",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "BYOK key set for anthropic: sk-ant-...",
    );
    logSpy.mockRestore();
  });

  it("shows configured BYOK keys", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    listByokKeysMock.mockResolvedValue([
      {
        provider: "openai",
        key_prefix: "sk-open",
        label: null,
        is_active: true,
      },
    ]);

    const { showByokKeysCommand } = await import("../../src/cli/commands/byok");

    await showByokKeysCommand(
      {
        baseUrl: "https://api.aomi.dev",
        app: "default",
        secrets: {},
      },
      { printLocation: false },
    );

    expect(listByokKeysMock).toHaveBeenCalledWith("session-1");
    expect(logSpy).toHaveBeenCalledWith("  openai: sk-open...");
    logSpy.mockRestore();
  });

  it("clears all configured BYOK keys", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    listByokKeysMock.mockResolvedValue([
      {
        provider: "anthropic",
        key_prefix: "sk-ant-",
        label: null,
        is_active: true,
      },
      {
        provider: "openai",
        key_prefix: "sk-open",
        label: null,
        is_active: true,
      },
    ]);

    const { clearByokKeysCommand } =
      await import("../../src/cli/commands/byok");

    await clearByokKeysCommand(
      {
        baseUrl: "https://api.aomi.dev",
        app: "default",
        secrets: {},
      },
      { printLocation: false },
    );

    expect(deleteByokKeyMock).toHaveBeenNthCalledWith(
      1,
      "session-1",
      "anthropic",
    );
    expect(deleteByokKeyMock).toHaveBeenNthCalledWith(2, "session-1", "openai");
    expect(logSpy).toHaveBeenCalledWith(
      "BYOK keys cleared. Using system keys.",
    );
    logSpy.mockRestore();
  });

  it("rejects invalid BYOK-key input", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { saveByokKeyCommand } = await import("../../src/cli/commands/byok");

    await expect(
      saveByokKeyCommand(
        {
          baseUrl: "https://api.aomi.dev",
          app: "default",
          secrets: {},
        },
        "bad-format",
        { printLocation: false },
      ),
    ).rejects.toBeInstanceOf(CliExit);

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
