import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createControlClient: vi.fn(),
  invoke: vi.fn(),
  listApps: vi.fn(),
}));

vi.mock("../../src/cli/context", () => ({
  createControlClient: (...args: unknown[]) => {
    mocks.createControlClient(...args);
    return {
      pipeline: {
        apps: { list: mocks.listApps },
        app: () => ({ invoke: mocks.invoke }),
      },
    };
  },
}));

vi.mock("../../src/cli/cli-session", () => ({
  CliSession: {
    load: () => ({ sessionId: "active-session", app: "portfolio" }),
  },
}));

import {
  parsePipelineArguments,
  pipelineAppsCommand,
  pipelineCallCommand,
} from "../../src/cli/commands/pipeline";

describe("Pipeline CLI", () => {
  beforeEach(() => {
    mocks.createControlClient.mockReset();
    mocks.invoke.mockReset().mockResolvedValue({ balance: 1 });
    mocks.listApps.mockReset().mockResolvedValue({
      kind: "directory",
      path: "/v1/pipeline/apps",
      entries: [
        { name: "portfolio", kind: "directory", href: "/portfolio" },
        { name: "swap", kind: "directory", href: "/swap" },
      ],
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("invokes the selected app operation through the filesystem API", async () => {
    await pipelineCallCommand(
      { baseUrl: "https://portal.example", secrets: {} },
      {
        toolId: "svm_get_balance",
        arguments: '{"owner":"wallet"}',
        app: "portfolio",
        idempotencyKey: "call-1",
      },
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      "svm_get_balance",
      {
        owner: "wallet",
      },
      { idempotencyKey: "call-1" },
    );
    expect(mocks.createControlClient).toHaveBeenCalledWith(
      expect.objectContaining({ secrets: {} }),
      expect.objectContaining({
        payment: true,
        onPayment: expect.any(Function),
      }),
    );
  });

  it("filters the canonical app directory locally", async () => {
    await pipelineAppsCommand({ secrets: {} }, { query: "port", limit: 1 });

    expect(mocks.listApps).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"name": "portfolio"'),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining('"name": "swap"'),
    );
  });

  it("rejects non-object argument JSON before any request", () => {
    expect(() => parsePipelineArguments("[]")).toThrow(
      "--arguments must be a JSON object",
    );
  });

  it("rejects hosted-app control metadata before invocation", async () => {
    await expect(
      pipelineCallCommand(
        { secrets: {} },
        {
          toolId: "balance",
          applicationId: "42",
          idempotencyKey: "call-2",
        },
      ),
    ).rejects.toThrow(
      "Pipeline filesystem operations do not accept hosted-app control metadata",
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
