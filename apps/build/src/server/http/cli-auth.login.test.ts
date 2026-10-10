import { parse } from "cookie-es";
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  readGitHubCliExchange,
  readGitHubOAuthRequest,
} from "@/server/cookies/github";
import { GITHUB_OAUTH_REQUEST_COOKIE } from "@/server/github-auth";
import { cliLoginRoute as GET } from "./cli-auth";

const { getGitHubSession } = vi.hoisted(() => ({
  getGitHubSession: vi.fn(),
}));
vi.mock("@/server/cookies/github", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/cookies/github")>();
  return {
    ...actual,
    getGitHubSession: () => getGitHubSession(),
  };
});

function loginUrl() {
  const url = new URL("https://build-staging.aomi.dev/api/bff/cli/login");
  url.searchParams.set("redirect_uri", "http://127.0.0.1:43210/callback");
  url.searchParams.set("state", "s".repeat(43));
  url.searchParams.set("code_challenge", "c".repeat(43));
  return url;
}

describe("CLI browser login", () => {
  beforeEach(() => {
    vi.stubEnv(
      "PORTAL_ONLY_SESSION_SECRET",
      "test-only-session-secret-that-is-long-enough",
    );
    getGitHubSession.mockReset();
  });

  it("rejects non-loopback callback URLs", async () => {
    const url = loginUrl();
    url.searchParams.set("redirect_uri", "https://attacker.example/callback");

    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
  });

  it("reuses the existing Build browser session without opening GitHub", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });

    const response = await GET(new Request(loginUrl()));
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.origin).toBe("http://127.0.0.1:43210");
    expect(redirect.searchParams.get("state")).toBe("s".repeat(43));
    await expect(
      readGitHubCliExchange(redirect.searchParams.get("code") ?? undefined),
    ).resolves.toMatchObject({
      session: { githubUserId: "42", githubLogin: "alice" },
      codeChallenge: "c".repeat(43),
    });
  });

  it("sends signed-out users through the existing GitHub callback", async () => {
    getGitHubSession.mockResolvedValue(null);

    const response = await GET(new Request(loginUrl()));
    const authorize = new URL(response.headers.get("location")!);
    expect(authorize.origin).toBe("https://github.com");
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      "https://build-staging.aomi.dev/api/bff/auth/github/callback",
    );

    const cookie = parse(response.headers.get("set-cookie") ?? "")[
      GITHUB_OAUTH_REQUEST_COOKIE
    ];
    await expect(readGitHubOAuthRequest(cookie)).resolves.toMatchObject({
      continuation: {
        kind: "cli",
        redirectUri: "http://127.0.0.1:43210/callback",
        state: "s".repeat(43),
        codeChallenge: "c".repeat(43),
      },
    });
  });
});
