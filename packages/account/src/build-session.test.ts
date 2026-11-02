// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import { GitHubSessionSigner } from "./build-session";
let signer: GitHubSessionSigner;

const session = {
  githubUserId: "12345",
  githubLogin: "builder",
  installationId: "67890",
};

describe("GitHub CLI sessions", () => {
  beforeEach(() => {
    signer = new GitHubSessionSigner(
      "test-only-session-secret-that-is-long-enough",
    );
  });

  it("accepts only the explicitly required CLI scopes", async () => {
    const token = await signer.issueCliSession(session);
    await expect(signer.readCliSession(token, "deploy")).resolves.toEqual(
      session,
    );
  });

  it("does not accept a browser session cookie as a CLI bearer", async () => {
    const browserToken = await signer.issueSession(session);
    await expect(signer.readCliSession(browserToken)).resolves.toBeNull();
  });

  it("treats malformed credentials and missing read config as unauthenticated", async () => {
    await expect(signer.readSession("not-a-jwt")).resolves.toBeNull();

    expect(() => new GitHubSessionSigner("")).toThrow("BUILD_SESSION_SECRET");
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

    const token = await signer.issueOAuthRequest(request);
    await expect(signer.readOAuthRequest(token)).resolves.toEqual(request);
  });

  it("makes repeated PKCE exchanges idempotent", async () => {
    const code = await signer.issueCliExchange(session, "c".repeat(43));
    const first = await signer.readCliExchange(code);
    const second = await signer.readCliExchange(code);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.accessToken).toBe(second?.accessToken);
  });
});
