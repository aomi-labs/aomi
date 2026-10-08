import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  all: vi.fn(),
  update: vi.fn(),
  getThread: vi.fn(),
  getAccountDefault: vi.fn(),
  setThread: vi.fn(),
  setAccountDefault: vi.fn(),
}));
vi.mock("../cli-session", () => ({
  CliSession: {
    loadOrCreate: () => ({
      sessionId: "active-thread",
      createClientSession: () => ({
        close: mocks.close,
        client: {
          agent: { sessions: { all: mocks.all, update: mocks.update } },
          transactionSafety: mocks,
        },
      }),
    }),
  },
}));
vi.mock("../state", () => ({
  listStoredSessions: () => [{ sessionId: "remote-thread", localId: 3 }],
}));
vi.mock("../errors", () => ({
  fatal: (message: string) => {
    throw new Error(message);
  },
}));
import { guardCommand } from "./guard";
import {
  threadsCommand,
  updateThreadCommand,
} from "./threads";
const config = { secrets: {}, json: true };
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.getThread.mockResolvedValue({ mode: "balanced", revision: 8 });
  mocks.getAccountDefault.mockResolvedValue({ mode: "balanced", revision: 3 });
  mocks.setThread.mockResolvedValue({ mode: "guarded_only", revision: 9 });
});
describe("CLI parity uses owned remote state", () => {
  it("lists the remote catalog rather than locally stored session history", async () => {
    mocks.all.mockResolvedValue([
      { id: "other-device", title: "Remote chat", archived: false },
    ]);
    await threadsCommand(config);
    expect(mocks.all).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("other-device"),
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("maps local selectors to exact remote IDs for rename and archive", async () => {
    mocks.update.mockResolvedValue({ id: "remote-thread" });
    await updateThreadCommand(config, "session-3", { title: "Renamed" });
    await updateThreadCommand(config, "session-3", { archived: true });
    expect(mocks.update.mock.calls).toEqual([
      ["remote-thread", { title: "Renamed" }],
      ["remote-thread", { archived: true }],
    ]);
  });
  it("reads the authoritative revision for guard writes and propagates conflicts", async () => {
    mocks.setThread.mockRejectedValue(new Error("revision_conflict"));
    await expect(
      guardCommand(config, { thread: "session-3", mode: "guarded_only" }),
    ).rejects.toThrow("revision_conflict");
    expect(mocks.setThread).toHaveBeenCalledWith(
      "remote-thread",
      "guarded_only",
      8,
    );
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("refuses unrestricted account defaults without writing", async () => {
    await expect(
      guardCommand(config, { account: true, mode: "unrestricted" }),
    ).rejects.toThrow("Account defaults cannot be unrestricted");
    expect(mocks.setAccountDefault).not.toHaveBeenCalled();
    expect(mocks.setThread).not.toHaveBeenCalled();
  });
});
