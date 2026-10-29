// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getGitHubCliSessionFromRequest,
  issueGitHubCliSession,
  issueGitHubSession,
  readGitHubCliSession,
  readGitHubSession,
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
  });
});
