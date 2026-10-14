// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRunDownloadRoute,
  buildRunFileRoute,
  buildRunStatusRoute,
  createBuildRunRoute,
} from "./routes";

const mocks = vi.hoisted(() => {
  class BuildEngineError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return {
    BuildEngineError,
    capture: vi.fn(),
    handle: vi.fn(),
    startBuildRun: vi.fn(),
    snapshotBuildRun: vi.fn(),
    getBuildRun: vi.fn(),
    reconstructBuildRun: vi.fn(),
    readRunFile: vi.fn(),
    storedCrateTarball: vi.fn(),
  };
});

vi.mock("@/server/bff/failures", () => ({
  buildFailures: {
    handle: (input: {
      source: string;
      error: unknown;
      response?: { status: number; error: string };
      context: Record<string, unknown>;
    }) => {
      const response = input.response ?? {
        status: 500,
        error: "internal_error",
      };
      mocks.handle(input);
      if (input.source !== "expected") {
        mocks.capture(input.error, {
          ...input.context,
          status: response.status,
        });
      }
      return {
        response: Response.json(
          { error: response.error },
          { status: response.status },
        ),
      };
    },
  },
}));

vi.mock("@/server/bff/auth", () => ({
  authorize: vi.fn(async () => ({ session: null })),
}));

vi.mock("./engine", () => ({
  BuildEngineError: mocks.BuildEngineError,
  startBuildRun: mocks.startBuildRun,
  snapshotBuildRun: mocks.snapshotBuildRun,
  getBuildRun: mocks.getBuildRun,
  reconstructBuildRun: mocks.reconstructBuildRun,
  cancelBuildRun: vi.fn(),
  decideBuildRun: vi.fn(),
  readRunFile: mocks.readRunFile,
  storedCrateTarball: mocks.storedCrateTarball,
}));

function createRequest(): Request {
  return new Request("http://localhost:3000/api/bff/build/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "make an app" }),
  });
}

describe("build route error classification", () => {
  beforeEach(() => {
    mocks.capture.mockReset();
    mocks.handle.mockReset();
    mocks.startBuildRun.mockReset();
    mocks.snapshotBuildRun.mockReset();
    mocks.getBuildRun.mockReset();
    mocks.reconstructBuildRun.mockReset();
    mocks.readRunFile.mockReset();
    mocks.storedCrateTarball.mockReset();
  });

  it("preserves a typed 4xx BuildEngineError without telemetry", async () => {
    mocks.startBuildRun.mockRejectedValue(
      new mocks.BuildEngineError("invalid build plan", 400),
    );

    const response = await createBuildRunRoute(createRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid build plan",
    });
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.handle).toHaveBeenCalledWith({
      source: "expected",
      error: expect.objectContaining({ message: "invalid build plan" }),
      response: { status: 400, error: "invalid build plan" },
      context: {
        routeFamily: "/api/bff/build/runs",
        operation: "build.start",
        method: "POST",
      },
    });
  });

  it("captures a typed 5xx BuildEngineError without changing its response", async () => {
    const error = new mocks.BuildEngineError("private SDK path", 503);
    mocks.startBuildRun.mockRejectedValue(error);

    const response = await createBuildRunRoute(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "private SDK path",
    });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build/runs",
      operation: "build.start",
      method: "POST",
      status: 503,
    });
  });

  it("captures and sanitizes an unknown build exception", async () => {
    const error = new Error("private build detail");
    mocks.startBuildRun.mockRejectedValue(error);

    const response = await createBuildRunRoute(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "build engine error",
    });
    expect(mocks.capture).toHaveBeenCalledOnce();
  });

  it("owns snapshot failures in the status route exactly once", async () => {
    const handle = {};
    const error = new Error("store failed");
    mocks.getBuildRun.mockReturnValue(handle);
    mocks.snapshotBuildRun.mockRejectedValue(error);

    const response = await buildRunStatusRoute(
      new Request("http://localhost:3000/api/bff/build/runs?id=private-run"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "build engine error",
    });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build/runs",
      operation: "build.status",
      method: "GET",
      status: 500,
    });
  });

  it.each([
    ["download", buildRunDownloadRoute],
    ["file", buildRunFileRoute],
  ])(
    "preserves the %s unknown-run response after reconstruction fails",
    async (_, route) => {
      mocks.reconstructBuildRun.mockResolvedValue(undefined);
      const response = await route(
        new Request(
          "http://localhost:3000/api/bff/build/runs/download?id=private-run&path=private-app/src/lib.rs",
        ),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "unknown run",
      });
      expect(mocks.capture).not.toHaveBeenCalled();
    },
  );

  it("returns a sanitized 500 when a file store read fails", async () => {
    const handle = { app: "private-app", plan: { sdkRoot: "/missing" } };
    const error = new Error("private artifact store failure");
    mocks.getBuildRun.mockReturnValue(handle);
    mocks.readRunFile.mockRejectedValue(error);

    const response = await buildRunFileRoute(
      new Request(
        "http://localhost:3000/api/bff/build/runs/file?id=private-run&path=private-app/src/lib.rs",
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "build engine error",
    });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build/runs/file",
      operation: "build.file",
      method: "GET",
      status: 500,
    });
  });

  it("preserves the 409 fallback when the stored download read fails", async () => {
    const handle = {
      app: "private-app",
      plan: { sdkRoot: "/definitely/missing" },
    };
    const error = new Error("private artifact download failure");
    mocks.getBuildRun.mockReturnValue(handle);
    mocks.storedCrateTarball.mockRejectedValue(error);

    const response = await buildRunDownloadRoute(
      new Request(
        "http://localhost:3000/api/bff/build/runs/download?id=private-run",
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "no generated crate yet — run the build first",
    });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build/runs/download",
      operation: "build.download_artifact_read",
      method: "GET",
      status: 409,
    });
    expect(mocks.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        response: {
          status: 409,
          error: "no generated crate yet — run the build first",
        },
      }),
    );
  });
});
