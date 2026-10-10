// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const failures = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("@/server/bff/failures", () => ({
  buildFailures: { handle: failures.handle },
}));

import { githubDevSessionRoute as GET } from "./github-auth";

vi.mock("@/server/cookies/github", () => ({
  setGitHubSessionCookie: vi.fn(),
}));

afterEach(() => {
  failures.handle.mockReset();
  vi.unstubAllGlobals();
});

describe("GitHub dev session route", () => {
  it("is not available off localhost", async () => {
    const res = await GET(
      new Request(
        "https://chat-staging.aomi.dev/api/bff/auth/github/dev-session?login=alice",
      ),
    );
    expect(res.status).toBe(404);
  });

  it("requires a login on localhost", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/bff/auth/github/dev-session"),
    );
    expect(res.status).toBe(400);
  });

  it("returns GitHub lookup failures for local debugging", async () => {
    failures.handle.mockImplementation((input) => ({
      response: Response.json(
        { error: input.response.error },
        { status: input.response.status },
      ),
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    const res = await GET(
      new Request(
        "http://localhost:3000/api/bff/auth/github/dev-session?login=alice",
      ),
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "github_user_lookup_failed",
    });
    expect(failures.handle).toHaveBeenCalledWith({
      source: "local",
      error: expect.objectContaining({
        message: "GitHub user lookup failed (503)",
      }),
      response: {
        status: 502,
        error: "github_user_lookup_failed",
      },
      context: {
        routeFamily: "/api/bff/auth/github/dev-session",
        operation: "github.dev_session",
        method: "GET",
      },
    });
  });
});
