import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAccountApps: vi.fn(),
  addAccountApp: vi.fn(),
  removeAccountApp: vi.fn(),
  getAppCredentialsStatus: vi.fn(),
  setAppCredential: vi.fn(),
  replaceAppCredential: vi.fn(),
  removeAppCredential: vi.fn(),
}));

vi.mock("../../src/cli/context", () => ({
  createControlClient: vi.fn(() => mocks),
}));

vi.mock("../../src/cli/cli-session", () => ({
  CliSession: {
    loadOrCreate: vi.fn(() => ({
      baseUrl: "https://api.example",
      apiKey: undefined,
      sessionId: "session-1",
    })),
  },
}));

import {
  accountAppsCommand,
  addAccountAppCommand,
  appCredentialStatusCommand,
  removeAccountAppCommand,
  removeAppCredentialCommand,
  setAppCredentialCommand,
} from "../../src/cli/commands/apps";

const catalog = [
  {
    name: "venue",
    label: "Venue",
    applicationId: 42,
    isInstalled: true,
    secrets: [
      {
        name: "VENUE_KEY",
        description: "Personal API key",
        required: true,
        user_own: true,
      },
    ],
  },
];

const missing = {
  application_id: 42,
  app: "venue",
  ready: false,
  missing_required: ["VENUE_KEY"],
  slots: [
    {
      ...catalog[0].secrets[0],
      configured: false,
      app_provided: false,
    },
  ],
};

const ready = {
  ...missing,
  ready: true,
  missing_required: [],
  slots: [{ ...missing.slots[0], configured: true }],
};

describe("CLI account app commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAccountApps.mockResolvedValue(catalog);
    mocks.addAccountApp.mockResolvedValue({
      application_id: 42,
      app: "venue",
      installed: true,
      apps: ["default", "venue"],
    });
    mocks.removeAccountApp.mockResolvedValue({
      application_id: 42,
      app: "venue",
      installed: false,
      apps: ["default"],
    });
    mocks.getAppCredentialsStatus.mockResolvedValue(missing);
    mocks.setAppCredential.mockResolvedValue(ready);
    mocks.replaceAppCredential.mockResolvedValue(ready);
    mocks.removeAppCredential.mockResolvedValue({ deleted: true });
  });

  it("lists install status and adds or removes by canonical application ID", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await accountAppsCommand({ secrets: {} });
    await addAccountAppCommand({ secrets: {} }, "42");
    await removeAccountAppCommand({ secrets: {} }, "42");

    expect(log).toHaveBeenCalledWith("venue  id=42  installed");
    expect(mocks.addAccountApp).toHaveBeenCalledWith("session-1", 42);
    expect(mocks.removeAccountApp).toHaveBeenCalledWith("session-1", "42");
    log.mockRestore();
  });

  it("prints credential status without values", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await appCredentialStatusCommand({ secrets: {} }, "42");

    expect(log).toHaveBeenCalledWith("venue credentials: setup required");
    expect(log).toHaveBeenCalledWith(
      "VENUE_KEY  required  missing  Personal API key",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-value");
    log.mockRestore();
  });

  it("sets and replaces credentials read from a secure input callback", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const readSecret = vi
      .fn()
      .mockResolvedValueOnce("first-secret")
      .mockResolvedValueOnce("replacement-secret");

    await setAppCredentialCommand({ secrets: {} }, "42", "VENUE_KEY", {
      readSecret,
    });
    mocks.getAppCredentialsStatus.mockResolvedValueOnce(ready);
    await setAppCredentialCommand({ secrets: {} }, "42", "VENUE_KEY", {
      readSecret,
      replace: true,
    });

    expect(readSecret).toHaveBeenCalledWith("venue VENUE_KEY: ");
    expect(mocks.setAppCredential).toHaveBeenCalledWith(
      "session-1",
      42,
      "VENUE_KEY",
      "first-secret",
    );
    expect(mocks.replaceAppCredential).toHaveBeenCalledWith(
      "session-1",
      42,
      "VENUE_KEY",
      "replacement-secret",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    log.mockRestore();
  });

  it("removes a saved credential without reading or printing its value", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await removeAppCredentialCommand({ secrets: {} }, "venue", "VENUE_KEY");

    expect(mocks.removeAppCredential).toHaveBeenCalledWith(
      "session-1",
      42,
      "VENUE_KEY",
    );
    expect(log).toHaveBeenCalledWith("VENUE_KEY removed from venue.");
    log.mockRestore();
  });
  it("retires an unavailable app and its credentials by ID without discovery", async () => {
    mocks.listAccountApps.mockResolvedValue([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await removeAccountAppCommand({ secrets: {} }, "42");
    await removeAppCredentialCommand({ secrets: {} }, "42", "VENUE_KEY");
    expect(mocks.listAccountApps).not.toHaveBeenCalled();
    expect(mocks.removeAccountApp).toHaveBeenCalledWith("session-1", "42");
    expect(mocks.removeAppCredential).toHaveBeenCalledWith(
      "session-1",
      "42",
      "VENUE_KEY",
    );
  });
});
