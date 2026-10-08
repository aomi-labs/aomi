import { beforeEach, describe, expect, it, vi } from "vitest";
import { CliExit } from "../errors";

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

vi.mock("@aomi-labs/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@aomi-labs/client")>()),
  AomiClient: vi.fn(() => ({
    listByokKeys: listByokKeysMock,
    saveByokKey: saveByokKeyMock,
    deleteByokKey: deleteByokKeyMock,
  })),
}));

vi.mock("../cli-session", () => ({
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
      toState: () => ({ accountBearer: "account-token", auth: undefined }),
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
    const { saveByokKeyCommand } = await import("./byok");

    await saveByokKeyCommand(
      {
        baseUrl: "https://api.aomi.dev",
        app: "default",
        secrets: {},
      },
      "anthropic:sk-ant-test",
      { printLocation: false },
    );

    const { AomiClient } = await import("@aomi-labs/client");
    const options = vi.mocked(AomiClient).mock.calls.at(-1)![0];
    expect(await options.getAccountBearer!()).toBe("account-token");
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

    const { showByokKeysCommand } = await import("./byok");

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

  it("prints one parseable masked result for JSON list, including no keys", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { showByokKeysCommand } = await import("./byok");
    const config = {
      baseUrl: "https://api.aomi.dev",
      app: "default",
      secrets: {},
      json: true,
    };
    await showByokKeysCommand(config);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0])).toEqual([]);
    logSpy.mockClear();
    const masked = {
      provider: "openai",
      key_prefix: "sk-open",
      label: null,
      is_active: true,
    };
    listByokKeysMock.mockResolvedValue([masked]);
    await showByokKeysCommand(config);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logSpy.mock.calls[0]![0])).toEqual([masked]);
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

    const { clearByokKeysCommand } = await import("./byok");

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
    const { saveByokKeyCommand } = await import("./byok");

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
