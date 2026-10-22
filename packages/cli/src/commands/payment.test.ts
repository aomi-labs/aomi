// @vitest-environment node
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  status: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  load: vi.fn(),
  control: vi.fn(),
  construct: vi.fn(),
}));
vi.mock("@aomi-labs/client", async (original) => ({
  ...(await original<typeof import("@aomi-labs/client")>()),
  EvmPayment: class {
    preflight = mocks.preflight;
    status = mocks.status;
  },
  CommitController: class {
    constructor(...args: unknown[]) {
      mocks.construct(...args);
    }
    refresh = mocks.refresh;
    close = mocks.close;
  },
}));
vi.mock("../cli-session", () => ({ CliSession: { load: mocks.load } }));
vi.mock("../context", () => ({ createControlClient: mocks.control }));
import { paymentPreflightCommand, paymentStatusCommand } from "./payment";

let directory: string;
let file: string;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AOMI_CLI_STRICT_EXIT", "1");
  directory = mkdtempSync(join(tmpdir(), "aomi-payment-adapter-"));
  file = join(directory, "intent.json");
  writeFileSync(
    file,
    JSON.stringify({
      payment: {},
      rpcUrl: "https://rpc.example",
      sources: [{ role: "operational" }],
    }),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("runs funding through the shared SDK without opening a CLI session", async () => {
  mocks.preflight.mockResolvedValue({ selected: null });
  await paymentPreflightCommand(file);
  expect(mocks.preflight).toHaveBeenCalledWith([{ role: "operational" }]);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.control).not.toHaveBeenCalled();
});

it("refreshes the exact original Commit on the saved host before SDK reconciliation", async () => {
  const refreshed = { commit_id: "payment-1", transaction_id: "existing-hash" };
  mocks.load.mockReturnValue({
    sessionId: "original-thread",
    toState: () => ({ baseUrl: "https://saved.example" }),
  });
  mocks.control.mockReturnValue("control-client");
  mocks.refresh.mockResolvedValue(refreshed);
  mocks.status.mockResolvedValue({ canRequestSignature: false });
  await paymentStatusCommand({ secrets: {} }, "payment-1", file);
  expect(mocks.control).toHaveBeenCalledWith({
    secrets: {},
    baseUrl: "https://saved.example",
  });
  expect(mocks.construct).toHaveBeenCalledWith(
    "control-client",
    "original-thread",
  );
  expect(mocks.refresh).toHaveBeenCalledWith("payment-1");
  expect(mocks.status).toHaveBeenCalledWith(refreshed);
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("closes reconciliation when the existing Commit cannot be refreshed", async () => {
  mocks.load.mockReturnValue({
    sessionId: "original-thread",
    toState: () => ({ baseUrl: "https://saved.example" }),
  });
  mocks.refresh.mockRejectedValue(new Error("unavailable"));
  await expect(
    paymentStatusCommand({ secrets: {} }, "payment-1", file),
  ).rejects.toThrow();
  expect(mocks.status).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
});
