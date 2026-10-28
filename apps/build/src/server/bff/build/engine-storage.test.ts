// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SmitherBackend } from "@aomi-labs/smither";

const mocks = vi.hoisted(() => ({
  api: {},
  createAomiSmither: vi.fn(),
  findRunByOwnerApp: vi.fn(),
  resolveRunBackend: vi.fn(),
  prepareRun: vi.fn(),
  executeRunUntilSettled: vi.fn(),
  dispatchSandboxRun: vi.fn(),
}));

vi.mock("@aomi-labs/smither", () => ({
  createAomiSmither: mocks.createAomiSmither,
  resolveRunBackend: mocks.resolveRunBackend,
  prepareRun: mocks.prepareRun,
  executeRunUntilSettled: mocks.executeRunUntilSettled,
  crateFileTree: vi.fn(),
  decideApproval: vi.fn(),
  defaultSdkRoot: vi.fn(),
  finalizePlan: vi.fn(),
  readRunView: vi.fn(),
  requestRunCancel: vi.fn(),
  sanitizeAppName: vi.fn(),
  stageKeyForNode: vi.fn(),
  stagesFor: vi.fn(),
}));
vi.mock("./registry", () => ({
  findRunByOwnerApp: mocks.findRunByOwnerApp,
  findRunById: vi.fn(),
  registerRun: vi.fn(),
  updateRun: vi.fn(),
}));
vi.mock("./supervisor", () => ({ ensureSupervisorInterval: vi.fn() }));
vi.mock("./sidecar-auth", () => ({
  mintSidecarBearer: vi.fn(),
  sidecarVerifierPublicKeyPem: vi.fn(),
}));
vi.mock("./sandbox-runner", () => ({
  dispatchSandboxRun: mocks.dispatchSandboxRun,
  maybeExtendSandbox: vi.fn(),
  sandboxRunnerConfig: vi.fn(),
  stopSandbox: vi.fn(),
  stopSandboxById: vi.fn(),
}));
vi.mock("@/server/bff/failures", () => ({
  buildFailures: { handle: vi.fn() },
}));

import { startBuildRun } from "./engine";

describe("build engine storage initialization", () => {
  let directory: string;
  let runsRoot: string;
  const app = "fresh-app";
  const stop = new Error("stop after opening the store");
  const start = () =>
    startBuildRun({ app, owner: "owner", prompt: "fixture", builder: "none" });

  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(path.join(tmpdir(), "aomi-engine-storage-"));
    runsRoot = path.join(directory, ".smithers", "runs");
    vi.stubEnv("SMITHER_RUNS_ROOT", runsRoot);
    Reflect.deleteProperty(globalThis, Symbol.for("aomi-build.smither-engine"));
    mocks.resolveRunBackend.mockImplementation(
      (name: string, options: { runsRoot: string }): SmitherBackend => ({
        kind: "pglite",
        dataDir: path.join(options.runsRoot, name, "pglite"),
      }),
    );
    // Stop at the registry boundary without running agents or deployment.
    mocks.findRunByOwnerApp.mockRejectedValue(stop);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(globalThis, Symbol.for("aomi-build.smither-engine"));
    rmSync(directory, { recursive: true, force: true });
  });

  function openPgliteDirectory(backend: SmitherBackend) {
    if (backend.kind !== "pglite") throw new Error("unexpected backend");
    // Match PGlite NodeFS: its nonrecursive mkdir needs existing parents.
    if (!existsSync(backend.dataDir)) mkdirSync(backend.dataDir);
  }

  it("opens a fresh nested store once for concurrent requests and keeps it cached", async () => {
    let resolveApi!: (value: typeof mocks.api) => void;
    mocks.createAomiSmither.mockImplementation((backend: SmitherBackend) => {
      openPgliteDirectory(backend);
      return new Promise((resolve) => {
        resolveApi = resolve;
      });
    });
    expect(existsSync(runsRoot)).toBe(false);
    const requests = Promise.allSettled([start(), start()]);
    await vi.waitFor(() =>
      expect(mocks.createAomiSmither).toHaveBeenCalledOnce(),
    );
    expect(mocks.createAomiSmither).toHaveBeenCalledWith({
      kind: "pglite",
      dataDir: path.join(runsRoot, app, "pglite"),
    });
    resolveApi(mocks.api);
    expect(await requests).toEqual([
      { status: "rejected", reason: stop },
      { status: "rejected", reason: stop },
    ]);
    await expect(start()).rejects.toBe(stop);
    expect(mocks.createAomiSmither).toHaveBeenCalledOnce();
    expect(mocks.findRunByOwnerApp).toHaveBeenCalledWith(
      mocks.api,
      "owner",
      app,
    );
    expect(mocks.prepareRun).not.toHaveBeenCalled();
    expect(mocks.executeRunUntilSettled).not.toHaveBeenCalled();
    expect(mocks.dispatchSandboxRun).not.toHaveBeenCalled();
  });

  it("retries after the database rejects its first initialization", async () => {
    const failure = new Error("database initialization failed");
    mocks.createAomiSmither
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce((backend: SmitherBackend) => {
        openPgliteDirectory(backend);
        return Promise.resolve(mocks.api);
      });
    await expect(start()).rejects.toBe(failure);
    await expect(start()).rejects.toBe(stop);
    expect(mocks.createAomiSmither).toHaveBeenCalledTimes(2);
    expect(mocks.findRunByOwnerApp).toHaveBeenCalledOnce();
  });

  it("passes through the PostgreSQL backend without creating local run directories", async () => {
    const backend: SmitherBackend = {
      kind: "postgres",
      connectionString: "postgres://fixture.invalid/smither",
    };
    mocks.resolveRunBackend.mockReturnValue(backend);
    mocks.createAomiSmither.mockResolvedValue(mocks.api);
    await expect(start()).rejects.toBe(stop);
    expect(mocks.resolveRunBackend).toHaveBeenCalledWith(app, { runsRoot });
    expect(mocks.createAomiSmither).toHaveBeenCalledWith(backend);
    expect(readdirSync(directory)).toEqual([]);
    expect(mocks.prepareRun).not.toHaveBeenCalled();
    expect(mocks.dispatchSandboxRun).not.toHaveBeenCalled();
  });
});
