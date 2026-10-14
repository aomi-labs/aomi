// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "@aomi-labs/deploy";

import { githubCallbackRoute as GET } from "./github-auth";

const mocks = vi.hoisted(() => ({
  oauthState: undefined as string | undefined,
  continuation: { kind: "browser" } as
    | { kind: "browser" }
    | { kind: "template"; platform: string },
  exchangeGitHubCode: vi.fn(),
  setGitHubSessionCookie: vi.fn(),
  observeFailure: vi.fn(),
}));

vi.mock("@/server/bff/failures", () => ({
  buildFailures: { handle: mocks.observeFailure },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (name: string) =>
    name === "aomi_github_oauth_request" ? mocks.oauthState : undefined,
}));

vi.mock("@/server/bff/backend", () => ({
  backendClient: vi.fn(async () => ({
    exchangeGitHubCode: mocks.exchangeGitHubCode,
  })),
}));

vi.mock("@/server/cookies/github", () => ({
  readGitHubOAuthRequest: vi.fn(async () =>
    mocks.oauthState
      ? {
          oauthState: mocks.oauthState,
          continuation: mocks.continuation,
        }
      : null,
  ),
  setGitHubSessionCookie: mocks.setGitHubSessionCookie,
}));

describe("GitHub callback route", () => {
  beforeEach(() => {
    mocks.oauthState = undefined;
    mocks.continuation = { kind: "browser" };
    mocks.exchangeGitHubCode.mockReset();
    mocks.setGitHubSessionCookie.mockReset();
    mocks.observeFailure.mockReset();
    mocks.observeFailure.mockReturnValue({
      reason: "local_exception",
      responseStatus: 500,
      responseError: "internal_error",
    });
  });

  it("redirects callback failures back to deployments with the launch marker", async () => {
    const res = await GET(
      new Request(
        "http://localhost:3000/api/bff/auth/github/callback?code=x&state=y",
      ),
    );
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/operate/deployments");
    expect(location.searchParams.get("launch")).toBe("github");
    expect(location.searchParams.get("github_error")).toBe(
      "invalid_oauth_state",
    );
    expect(mocks.observeFailure).not.toHaveBeenCalled();
  });

  it("exchanges GitHub code with the one-shot app and matching redirect URI", async () => {
    mocks.oauthState = "state-123";
    mocks.exchangeGitHubCode.mockResolvedValue({
      githubUserId: "4738254",
      githubLogin: "han",
      installationId: "123",
    });

    const res = await GET(
      new Request(
        "http://localhost:3000/api/bff/auth/github/callback?code=code-123&state=state-123",
      ),
    );

    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/operate/deployments");
    expect(location.searchParams.get("launch")).toBe("github");
    expect(mocks.exchangeGitHubCode).toHaveBeenCalledWith({
      code: "code-123",
      app: 2,
      redirectUri: "http://localhost:3000/api/bff/auth/github/callback",
    });
    expect(mocks.setGitHubSessionCookie).toHaveBeenCalled();
  });

  it("returns a refreshed installation to the template wizard", async () => {
    mocks.oauthState = "state-123";
    mocks.continuation = { kind: "template", platform: "community" };
    mocks.exchangeGitHubCode.mockResolvedValue({
      githubUserId: "4738254",
      githubLogin: "han",
      installationId: "123",
    });

    const res = await GET(
      new Request(
        "https://build.aomi.dev/api/bff/auth/github/callback?code=code-123&state=state-123",
      ),
    );
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/operate/deployments/new");
    expect(location.searchParams.get("platform")).toBe("community");
    expect(location.searchParams.get("mode")).toBe("template");
    expect(mocks.setGitHubSessionCookie).toHaveBeenCalled();
  });

  it.each([
    [401, "exchange_failed"],
    [403, "service_auth_forbidden"],
  ])(
    "redirects backend service-auth %s with the existing error code",
    async (status, expectedError) => {
      mocks.oauthState = "state-123";
      const error = new BackendError(
        "exchange_github_code",
        status,
        "forbidden",
        "private upstream body",
      );
      mocks.exchangeGitHubCode.mockRejectedValue(error);
      mocks.observeFailure.mockReturnValue({
        reason: "service_credential_rejected",
        upstreamStatus: status,
        responseStatus: 500,
        responseError: "internal_error",
      });

      const res = await GET(
        new Request(
          "http://localhost:3000/api/bff/auth/github/callback?code=code-123&state=state-123",
        ),
      );

      expect(res.status).toBe(307);
      const location = new URL(res.headers.get("location") ?? "");
      expect(location.pathname).toBe("/operate/deployments");
      expect(location.searchParams.get("github_error")).toBe(expectedError);
      expect(mocks.observeFailure).toHaveBeenCalledOnce();
      expect(mocks.observeFailure).toHaveBeenCalledWith({
        source: "launch",
        error,
        context: {
          routeFamily: "/api/bff/auth/github/callback",
          operation: "github.oauth_exchange",
          method: "GET",
        },
      });
    },
  );
});
