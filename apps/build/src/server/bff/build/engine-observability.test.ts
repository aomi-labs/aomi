// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: {},
  capture: vi.fn(),
  createAomiSmither: vi.fn(),
  dispatchSandboxRun: vi.fn(),
  finalizePlan: vi.fn(),
  findRunById: vi.fn(),
  findRunByOwnerApp: vi.fn(),
  readRunView: vi.fn(),
  registerRun: vi.fn(),
  sandboxRunnerConfig: vi.fn(),
}));

vi.mock("@aomi-labs/smither", () => ({
  crateFileTree: vi.fn(() => []),
  createAomiSmither: mocks.createAomiSmither,
  decideApproval: vi.fn(),
  defaultSdkRoot: vi.fn(() => "/tmp"),
  executeRunUntilSettled: vi.fn(),
  finalizePlan: mocks.finalizePlan,
  prepareRun: vi.fn(),
  readRunView: mocks.readRunView,
  requestRunCancel: vi.fn(),
  resolveRunBackend: vi.fn(() => ({})),
  sanitizeAppName: vi.fn((value: string) => value),
  stageKeyForNode: vi.fn((value: string) => value),
  stagesFor: vi.fn(() => []),
}));

vi.mock("./registry", () => ({
  findRunById: mocks.findRunById,
  findRunByOwnerApp: mocks.findRunByOwnerApp,
  registerRun: mocks.registerRun,
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
  sandboxRunnerConfig: mocks.sandboxRunnerConfig,
  stopSandbox: vi.fn(),
  stopSandboxById: vi.fn(),
}));
vi.mock("@/server/bff/failures", () => ({
  buildFailures: {
    handle: (input: {
      error: unknown;
      response?: { status: number; error: string };
      upstream?: string;
      context: Record<string, unknown>;
    }) =>
      mocks.capture(input.error, {
        ...input.context,
        status: input.response?.status ?? 500,
        ...(input.upstream ? { upstream: input.upstream } : {}),
      }),
  },
}));

import { readRunFile, reconstructBuildRun, startBuildRun } from "./engine";

const runId = "smither-test-app-00000000-0000-0000-0000-000000000001";

describe("build engine operational failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(
      globalThis,
      Symbol.for("aomi-build.smither-engine"),
    );
    mocks.createAomiSmither.mockResolvedValue(mocks.api);
  });

  it("observes a registry failure and preserves the unknown-run fallback", async () => {
    const error = new Error("private registry failure");
    mocks.findRunById.mockRejectedValue(error);

    await expect(reconstructBuildRun(runId)).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build",
      operation: "build.reconstruct_run",
      status: 500,
    });
  });

  it("observes an observer-store failure and preserves the unknown-run fallback", async () => {
    const error = new Error("private run store failure");
    mocks.findRunById.mockResolvedValue({
      runId,
      ownerLogin: "owner",
      app: "test-app",
      runner: "vercel-sandbox",
      status: "running",
      sandboxId: "sandbox",
      sidecarUrl: "",
      planJson: "{}",
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    mocks.readRunView.mockRejectedValue(error);

    await expect(reconstructBuildRun(runId)).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build",
      operation: "build.reconstruct_run",
      status: 500,
    });
  });

  it("returns undefined only when the durable store confirms absence", async () => {
    mocks.findRunById.mockResolvedValue(undefined);
    mocks.readRunView.mockResolvedValue({
      status: null,
      nodes: [],
      outputs: {},
    });

    await expect(reconstructBuildRun(runId)).resolves.toBeUndefined();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("reports a failed second resume read and starts a replacement run", async () => {
    const error = new Error("private observer store failure");
    mocks.findRunByOwnerApp.mockResolvedValue({
      runId,
      ownerLogin: "owner",
      app: "test-app",
      runner: "vercel-sandbox",
      status: "running",
      sandboxId: "old-sandbox",
      sidecarUrl: "",
      planJson: "{}",
      createdAtMs: 1,
      updatedAtMs: 1,
    });
    mocks.readRunView
      .mockResolvedValueOnce({ status: "running", nodes: [], outputs: {} })
      .mockRejectedValueOnce(error);
    mocks.finalizePlan.mockReturnValue({
      plan: { app: "test-app", sdkRoot: "/tmp" },
      issues: [],
    });
    mocks.sandboxRunnerConfig.mockReturnValue({ sdkRoot: "/tmp" });
    mocks.dispatchSandboxRun.mockResolvedValue({
      sandbox: { sandboxId: "new-sandbox" },
      sidecarUrl: "",
    });
    mocks.registerRun.mockResolvedValue(undefined);
    vi.stubEnv("AOMI_BUILD_RUNNER", "vercel-sandbox");

    await expect(
      startBuildRun({ prompt: "test", owner: "owner", app: "test-app" }),
    ).resolves.toMatchObject({
      runId,
      dispatch: { sandbox: { sandboxId: "new-sandbox" } },
    });
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build",
      operation: "build.resume_observer_store_read",
      status: 500,
    });
  });

  it("reports a final artifact read failure with the returned 404 status", async () => {
    const error = new Error("private artifact store failure");
    mocks.findRunById.mockResolvedValue(undefined);
    mocks.readRunView.mockRejectedValue(error);

    await expect(
      readRunFile(
        {
          runId,
          app: "test-app",
          plan: { sdkRoot: "/definitely/missing" },
          api: mocks.api,
        } as never,
        "test-app/src/lib.rs",
      ),
    ).resolves.toBeNull();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build",
      operation: "build.file_artifact_read",
      status: 404,
    });
  });
});
