import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action } from "../../src/agent/types";

const SENDER = "0x1111111111111111111111111111111111111111";
const OTHER_SENDER = "0x9999999999999999999999999999999999999999";
const FIRST_TO = "0x2222222222222222222222222222222222222222";
const SECOND_TO = "0x3333333333333333333333333333333333333333";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  mergeConfig: vi.fn(),
  createClientSession: vi.fn(),
  fetchCurrentState: vi.fn(),
  close: vi.fn(),
  pending: vi.fn(),
}));

vi.mock("../../src/cli/cli-session", () => ({
  CliSession: { load: mocks.load },
}));

import { exportCommand } from "../../src/cli/commands/export";

function action(
  id: string,
  overrides: Partial<
    Extract<Action["request"], { type: "execute_evm" }>["transactions"][number]
  > = {},
): Action {
  return {
    type: "action",
    event_id: `event-${id}`,
    sequence: Number(id.match(/\d+/)?.[0] ?? 1),
    turn_id: "turn-1",
    occurred_at: 1,
    id,
    revision: 1,
    state: "pending",
    request: {
      type: "execute_evm",
      transactions: [
        {
          chain_id: 4326,
          from: SENDER,
          to: id === "action-1" ? FIRST_TO : SECOND_TO,
          value: "0",
          data: "0x",
          label: "Transaction",
          kind: "transaction",
          ...overrides,
        },
      ],
      simulation: {
        status: "passed",
        balanceChanges: [],
        warnings: [],
        fees: [],
        guards: [],
        gas: null,
        logs: [],
      },
    },
    result: null,
    created_at: 1,
    expires_at: null,
  };
}

function svmAction(id: string): Action {
  return {
    ...action(id),
    request: {
      type: "execute_svm",
      transactions: [],
      simulation: {
        status: "passed",
        balanceChanges: [],
        warnings: [],
        fees: [],
        guards: [],
        gas: null,
        logs: [],
      },
    },
  };
}

const config = {
  baseUrl: "http://127.0.0.1:8080",
  app: "default",
  secrets: {},
};

describe("aomi tx export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AOMI_CLI_STRICT_EXIT = "1";
    mocks.pending.mockReturnValue([
      action("action-1", { data: "0xaabb" }),
      action("action-2", { data: undefined, value: "1000" }),
    ]);
    mocks.fetchCurrentState.mockResolvedValue(undefined);
    mocks.createClientSession.mockReturnValue({
      fetchCurrentState: mocks.fetchCurrentState,
      actions: { pending: mocks.pending },
      close: mocks.close,
    });
    mocks.load.mockReturnValue({
      publicKey: SENDER,
      mergeConfig: mocks.mergeConfig,
      createClientSession: mocks.createClientSession,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.AOMI_CLI_STRICT_EXIT;
    vi.restoreAllMocks();
  });

  it("refreshes Actions and prints only ordered EIP-5792 JSON", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await exportCommand(config, ["action-2", "action-1"]);

    expect(mocks.mergeConfig).toHaveBeenCalledWith(config);
    expect(mocks.fetchCurrentState).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toEqual({
      version: "2.0.0",
      from: SENDER,
      chainId: "0x10e6",
      atomicRequired: false,
      calls: [
        { to: SECOND_TO, data: "0x", value: "0x3e8" },
        { to: FIRST_TO, data: "0xaabb", value: "0x0" },
      ],
    });
  });

  it("prints the MOSS call array", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await exportCommand(config, ["action-2", "action-1"], "moss");

    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toEqual([
      { to: SECOND_TO, data: "0x", value: "0x3e8" },
      { to: FIRST_TO, data: "0xaabb", value: "0x0" },
    ]);
  });

  it("prints a single MetaMask Agent Wallet handoff", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await exportCommand(config, ["action-1"], "metamask");

    expect(JSON.parse(stdout.mock.calls[0]?.[0] as string)).toEqual({
      chainId: 4326,
      payload: { to: FIRST_TO, data: "0xaabb", value: "0x0" },
    });
  });

  it("rejects MetaMask batches and unknown format aliases", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    await expect(
      exportCommand(config, ["action-1", "action-2"], "metamask"),
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      exportCommand(config, ["action-1"], "mm"),
    ).rejects.toMatchObject({ code: 1 });
    expect(stdout).not.toHaveBeenCalled();
  });

  it("requires selectors and an active session", async () => {
    await expect(exportCommand(config, [])).rejects.toMatchObject({ code: 1 });
    mocks.load.mockReturnValue(null);
    await expect(exportCommand(config, ["action-1"])).rejects.toMatchObject({
      code: 1,
    });
  });

  it("rejects duplicate, ambiguous, missing, and non-EVM Actions", async () => {
    await expect(
      exportCommand(config, ["action-1", "action-1"]),
    ).rejects.toMatchObject({ code: 1 });
    await expect(exportCommand(config, ["action"])).rejects.toMatchObject({
      code: 1,
    });
    await expect(exportCommand(config, ["missing"])).rejects.toMatchObject({
      code: 1,
    });
    mocks.pending.mockReturnValue([svmAction("action-svm")]);
    await expect(exportCommand(config, ["action-svm"])).rejects.toMatchObject({
      code: 1,
    });
  });

  it("rejects mixed chains and senders", async () => {
    mocks.pending.mockReturnValue([
      action("action-1"),
      action("action-2", { chain_id: 1 }),
    ]);
    await expect(
      exportCommand(config, ["action-1", "action-2"]),
    ).rejects.toMatchObject({ code: 1 });

    mocks.pending.mockReturnValue([
      action("action-1"),
      action("action-2", { from: OTHER_SENDER }),
    ]);
    await expect(
      exportCommand(config, ["action-1", "action-2"]),
    ).rejects.toMatchObject({ code: 1 });
  });

  it("rejects a session sender mismatch and malformed transaction fields", async () => {
    mocks.load.mockReturnValue({
      publicKey: OTHER_SENDER,
      mergeConfig: mocks.mergeConfig,
      createClientSession: mocks.createClientSession,
    });
    await expect(exportCommand(config, ["action-1"])).rejects.toMatchObject({
      code: 1,
    });

    mocks.load.mockReturnValue({
      publicKey: SENDER,
      mergeConfig: mocks.mergeConfig,
      createClientSession: mocks.createClientSession,
    });
    mocks.pending.mockReturnValue([action("action-1", { data: "0x123" })]);
    await expect(exportCommand(config, ["action-1"])).rejects.toMatchObject({
      code: 1,
    });
    mocks.pending.mockReturnValue([action("action-1", { value: "wat" })]);
    await expect(exportCommand(config, ["action-1"])).rejects.toMatchObject({
      code: 1,
    });
  });
});
