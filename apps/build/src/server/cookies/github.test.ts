// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGitHubCliSessionFromRequest,
  issueGitHubCliExchange,
  issueGitHubCliSession,
  issueGitHubOAuthRequest,
  issueGitHubSession,
  readGitHubCliExchange,
  readGitHubCliSession,
  readGitHubSession,
  readGitHubOAuthRequest,
} from "./github";

const session = {
  githubUserId: "12345",
  githubLogin: "builder",
  installationId: "67890",
};

describe("GitHub CLI sessions", () => {
  beforeEach(() => {
    vi.stubEnv(
      "PORTAL_ONLY_SESSION_SECRET",
      "test-only-session-secret-that-is-long-enough",
    );
  });

  it("accepts only the explicitly required CLI scopes", async () => {
    const token = await issueGitHubCliSession(session);
    const request = new Request(
      "https://build.example.test/api/bff/cli/status",
      { headers: { authorization: `Bearer ${token}` } },
    );

    await expect(readGitHubCliSession(token, "deploy")).resolves.toEqual(
      session,
    );
    await expect(
      getGitHubCliSessionFromRequest(request, "activate"),
    ).resolves.toEqual(session);
  });

  it("does not accept a browser session cookie as a CLI bearer", async () => {
    const browserToken = await issueGitHubSession(session);
    await expect(readGitHubCliSession(browserToken)).resolves.toBeNull();
  });

  it("treats malformed credentials and missing read config as unauthenticated", async () => {
    await expect(readGitHubSession("not-a-jwt")).resolves.toBeNull();

    vi.stubEnv("PORTAL_ONLY_SESSION_SECRET", "");
    await expect(readGitHubSession("not-a-jwt")).resolves.toBeNull();
    await expect(readGitHubCliExchange("not-an-exchange")).resolves.toBeNull();
  });

  it("round-trips the shared OAuth continuation", async () => {
    const request = {
      oauthState: "oauth-state",
      continuation: {
        kind: "cli" as const,
        redirectUri: "http://127.0.0.1:43210/callback",
        state: "s".repeat(43),
        codeChallenge: "c".repeat(43),
      },
    };

    const token = await issueGitHubOAuthRequest(request);
    await expect(readGitHubOAuthRequest(token)).resolves.toEqual(request);
  });

  it("makes repeated PKCE exchanges idempotent", async () => {
    const code = await issueGitHubCliExchange(session, "c".repeat(43));
    const first = await readGitHubCliExchange(code);
    const second = await readGitHubCliExchange(code);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.accessToken).toBe(second?.accessToken);
  });
});
