// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GitHubSessionSigner } from "@aomi-labs/account/build-session";
import { getGitHubCliSessionFromRequest } from "./github";

afterEach(() => vi.unstubAllEnvs());
it("reads Edge-issued CLI credentials through the Build adapter", async () => {
  const secret = "test-only-session-secret-that-is-long-enough";
  vi.stubEnv("BUILD_SESSION_SECRET", secret);
  const session = {
    githubUserId: "123",
    githubLogin: "builder",
    installationId: null,
  };
  const token = await new GitHubSessionSigner(secret).issueCliSession(session);
  const request = new Request("https://build.example/api/build/runs", {
    headers: { authorization: `Bearer ${token}` },
  });
  await expect(
    getGitHubCliSessionFromRequest(request, "deploy"),
  ).resolves.toEqual(session);
  vi.stubEnv("BUILD_SESSION_SECRET", "");
  await expect(
    getGitHubCliSessionFromRequest(request, "deploy"),
  ).resolves.toBeNull();
});
