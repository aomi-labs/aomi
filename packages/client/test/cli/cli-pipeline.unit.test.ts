import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createControlClient: vi.fn(),
  read: vi.fn(),
  listApps: vi.fn(),
  listSkills: vi.fn(),
  app: vi.fn(),
  skill: vi.fn(),
  directory: vi.fn(),
  operations: vi.fn(),
  operation: vi.fn(),
  invoke: vi.fn(),
  instructions: vi.fn(),
  evmBuild: vi.fn(),
  evmStage: vi.fn(),
  evmSimulate: vi.fn(),
  evmCommit: vi.fn(),
  svmBuild: vi.fn(),
  svmStage: vi.fn(),
  svmSimulate: vi.fn(),
  svmCommit: vi.fn(),
}));

vi.mock("../../src/cli/context", () => ({
  createControlClient: (...args: unknown[]) => {
    mocks.createControlClient(...args);
    const scope = {
      directory: mocks.directory,
      operations: mocks.operations,
      operation: mocks.operation,
      invoke: mocks.invoke,
      instructions: mocks.instructions,
    };
    return {
      pipeline: {
        read: mocks.read,
        apps: { list: mocks.listApps },
        skills: { list: mocks.listSkills },
        app: (name: string) => {
          mocks.app(name);
          return scope;
        },
        skill: (name: string) => {
          mocks.skill(name);
          return scope;
        },
        evm: {
          build: mocks.evmBuild,
          stage: mocks.evmStage,
          simulate: mocks.evmSimulate,
          commit: mocks.evmCommit,
        },
        svm: {
          build: mocks.svmBuild,
          stage: mocks.svmStage,
          simulate: mocks.svmSimulate,
          commit: mocks.svmCommit,
        },
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
  pipelineAppsCommand,
  pipelineBuildCommand,
  pipelineInvokeCommand,
  pipelineLifecycleCommand,
  pipelineOperationsCommand,
} from "../../src/cli/commands/pipeline";
import { pipelineDef } from "../../src/cli/commands/defs/pipeline";
import { runCli } from "../../src/cli/main";

const directory = {
  kind: "directory" as const,
  path: "/v1/pipeline/apps",
  entries: [
    { name: "portfolio", kind: "directory" as const, href: "/portfolio" },
    { name: "swap", kind: "directory" as const, href: "/swap" },
  ],
};

const evmStaged = {
  version: 1 as const,
  status: "staged" as const,
  actions: [],
  digest: "evm-digest",
};

const evmSimulated = {
  ...evmStaged,
  status: "simulated" as const,
  simulation: { status: "success" },
};

const svmStaged = {
  version: 1 as const,
  status: "staged" as const,
  actions: [],
  digest: "svm-digest",
};

const svmSimulated = {
  ...svmStaged,
  status: "simulated" as const,
  simulation: { status: "success" },
};

let temporaryDirectory: string | undefined;

describe("Pipeline CLI", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.read.mockResolvedValue(directory);
    mocks.listApps.mockResolvedValue(directory);
    mocks.listSkills.mockResolvedValue(directory);
    mocks.directory.mockResolvedValue(directory);
    mocks.operations.mockResolvedValue(directory);
    mocks.operation.mockResolvedValue({
      kind: "operation",
      name: "supply",
      description: "Supply",
      method: "POST",
      href: "/v1/pipeline/apps/portfolio/operations/supply",
      inputSchema: { type: "object" },
      chainFamily: "evm",
    });
    mocks.invoke.mockResolvedValue({ balance: 1 });
    mocks.instructions.mockResolvedValue("# Skill\n");
    mocks.evmBuild.mockResolvedValue(evmSimulated);
    mocks.evmStage.mockResolvedValue(evmStaged);
    mocks.evmSimulate.mockResolvedValue(evmSimulated);
    mocks.evmCommit.mockResolvedValue({ status: "committed" });
    mocks.svmBuild.mockResolvedValue(svmSimulated);
    mocks.svmStage.mockResolvedValue(svmStaged);
    mocks.svmSimulate.mockResolvedValue(svmSimulated);
    mocks.svmCommit.mockResolvedValue({ status: "committed" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true });
      temporaryDirectory = undefined;
    }
  });

  it("exposes only the canonical SDK command surface", () => {
    expect(Object.keys(pipelineDef.subCommands ?? {})).toEqual([
      "read",
      "apps",
      "app",
      "skills",
      "skill",
      "operations",
      "operation",
      "invoke",
      "build",
      "evm",
      "svm",
    ]);
    expect(pipelineDef.subCommands).not.toHaveProperty("tools");
    expect(pipelineDef.subCommands).not.toHaveProperty("tool");
    expect(pipelineDef.subCommands).not.toHaveProperty("call");
    expect(pipelineDef.subCommands).not.toHaveProperty("run");
  });

  it("invokes an operation through the selected app SDK scope", async () => {
    await pipelineInvokeCommand(
      { baseUrl: "https://portal.example", secrets: {} },
      "svm_get_balance",
      {
        app: "portfolio",
        arguments: '{"owner":"wallet"}',
        idempotencyKey: "invoke-1",
      },
    );

    expect(mocks.app).toHaveBeenCalledWith("portfolio");
    expect(mocks.invoke).toHaveBeenCalledWith(
      "svm_get_balance",
      { owner: "wallet" },
      { idempotencyKey: "invoke-1" },
    );
    expect(mocks.createControlClient).toHaveBeenCalledWith(
      expect.objectContaining({ secrets: {} }),
      expect.objectContaining({
        payment: true,
        onPayment: expect.any(Function),
      }),
    );
  });

  it("reads operation arguments from an ordinary file path", async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "aomi-pipeline-cli-"));
    const path = join(temporaryDirectory, "arguments.json");
    await writeFile(path, '{"asset":"USDC","amount":"100"}');

    await pipelineInvokeCommand({ secrets: {} }, "supply", {
      app: "aave",
      arguments: path,
    });

    expect(mocks.invoke).toHaveBeenCalledWith(
      "supply",
      { asset: "USDC", amount: "100" },
      { idempotencyKey: undefined },
    );
  });

  it("builds and simulates through the high-level SDK", async () => {
    await pipelineBuildCommand({ secrets: {} }, "supply", {
      app: "aave",
      arguments: '{"asset":"USDC","amount":"100"}',
    });

    expect(mocks.operation).toHaveBeenCalledWith("supply");
    expect(mocks.evmBuild).toHaveBeenCalledWith({
      operation: "/v1/pipeline/apps/portfolio/operations/supply",
      arguments: { asset: "USDC", amount: "100" },
    });
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"status": "simulated"'),
    );
  });

  it("uses skill scopes without inheriting the active app", async () => {
    await pipelineOperationsCommand(
      { app: "configured-app", secrets: {} },
      { skill: "safe-lending" },
    );

    expect(mocks.skill).toHaveBeenCalledWith("safe-lending");
    expect(mocks.app).not.toHaveBeenCalled();
  });

  it("runs the complete raw EVM lifecycle and preserves the commit key", async () => {
    await pipelineLifecycleCommand(
      { secrets: {} },
      "evm",
      "stage",
      '{"actions":[]}',
    );
    await pipelineLifecycleCommand(
      { secrets: {} },
      "evm",
      "simulate",
      JSON.stringify(evmStaged),
    );
    await pipelineLifecycleCommand(
      { secrets: {} },
      "evm",
      "commit",
      JSON.stringify(evmSimulated),
      "commit-1",
    );

    expect(mocks.evmStage).toHaveBeenCalledWith({ actions: [] });
    expect(mocks.evmSimulate).toHaveBeenCalledWith(evmStaged);
    expect(mocks.evmCommit).toHaveBeenCalledWith(evmSimulated, {
      idempotencyKey: "commit-1",
    });
  });

  it("runs the complete raw SVM lifecycle", async () => {
    await pipelineLifecycleCommand(
      { secrets: {} },
      "svm",
      "build",
      '{"kind":"transaction","transaction":{"transaction":"AQ=="}}',
    );
    await pipelineLifecycleCommand(
      { secrets: {} },
      "svm",
      "simulate",
      JSON.stringify(svmStaged),
    );
    await pipelineLifecycleCommand(
      { secrets: {} },
      "svm",
      "commit",
      JSON.stringify(svmSimulated),
    );

    expect(mocks.svmStage).toHaveBeenCalledTimes(1);
    expect(mocks.svmSimulate).toHaveBeenCalledWith(svmStaged);
    expect(mocks.svmCommit).toHaveBeenCalledWith(svmSimulated, {
      idempotencyKey: undefined,
    });
  });

  it("dispatches the nested lifecycle through the built command tree", async () => {
    await runCli([
      "node",
      "aomi",
      "pipeline",
      "evm",
      "stage",
      '{"actions":[]}',
    ]);

    expect(mocks.evmStage).toHaveBeenCalledWith({ actions: [] });
  });

  it("rejects lifecycle artifacts at the wrong stage before the request", async () => {
    await expect(
      pipelineLifecycleCommand(
        { secrets: {} },
        "evm",
        "commit",
        JSON.stringify(evmStaged),
      ),
    ).rejects.toThrow("input must be a simulated Pipeline Build");
    expect(mocks.evmCommit).not.toHaveBeenCalled();
  });

  it("filters canonical directories locally", async () => {
    await pipelineAppsCommand({ secrets: {} }, { filter: "port", limit: 1 });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('"name": "portfolio"'),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining('"name": "swap"'),
    );
  });

  it("rejects invalid scopes and non-object arguments", async () => {
    await expect(
      pipelineInvokeCommand({ secrets: {} }, "supply", {
        app: "aave",
        arguments: "[]",
      }),
    ).rejects.toThrow("--arguments must be a JSON object");
    await expect(
      pipelineInvokeCommand({ secrets: {} }, "supply", {
        app: "aave",
        skill: "lending",
      }),
    ).rejects.toThrow("Choose only one of --app or --skill");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
