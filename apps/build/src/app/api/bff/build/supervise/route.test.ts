// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  superviseOnce: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/server/bff/build/supervisor", () => ({
  superviseOnce: mocks.superviseOnce,
}));

vi.mock("@/server/bff/failures", () => ({
  buildFailures: {
    handle: (input: {
      error: unknown;
      response: { status: number; error: string };
      context: Record<string, unknown>;
    }) => {
      mocks.capture(input.error, {
        ...input.context,
        status: input.response.status,
      });
      return {
        response: Response.json(
          { error: input.response.error },
          { status: input.response.status },
        ),
      };
    },
  },
}));

describe("build supervisor route", () => {
  beforeEach(() => {
    vi.stubEnv("AOMI_BUILD_ALLOW_ANON", "1");
    vi.stubEnv("NODE_ENV", "test");
    mocks.superviseOnce.mockReset();
    mocks.capture.mockReset();
  });

  it("captures once without returning private store details", async () => {
    const error = new Error("private store detail");
    mocks.superviseOnce.mockRejectedValue(error);

    const response = await GET(
      new Request("http://localhost:3000/api/bff/build/supervise"),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "build_supervision_failed",
    });
    expect(mocks.capture).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, {
      routeFamily: "/api/bff/build/supervise",
      operation: "build.supervisor_request",
      method: "GET",
      status: 500,
    });
  });
  it("requires the exact hosted cron credential", async () => {
    vi.stubEnv("AOMI_BUILD_ALLOW_ANON", "0");
    vi.stubEnv("BUILD_RUN_CHECKER_CRON_SECRET", "cron-test-secret");
    mocks.superviseOnce.mockResolvedValue([]);
    const url = "https://build.example/api/bff/build/supervise";
    expect(
      (
        await GET(
          new Request(url, { headers: { authorization: "Bearer wrong" } }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.superviseOnce).not.toHaveBeenCalled();
    expect(
      (
        await GET(
          new Request(url, {
            headers: { authorization: "Bearer cron-test-secret" },
          }),
        )
      ).status,
    ).toBe(200);
  });
});
