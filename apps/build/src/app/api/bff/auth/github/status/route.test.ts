// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getGitHubSession: vi.fn(),
}));

vi.mock("@/server/cookies/github", () => ({
  getGitHubSession: mocks.getGitHubSession,
}));

describe("GitHub status route", () => {
  beforeEach(() => {
    mocks.getGitHubSession.mockReset();
  });

  it("returns the signed-in GitHub account avatar without exposing the user id", async () => {
    mocks.getGitHubSession.mockResolvedValueOnce({
      githubUserId: "4738254",
      githubLogin: "han",
      installationId: "123",
    });

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      signedIn: true,
      githubLogin: "han",
      githubAvatarUrl:
        "https://avatars.githubusercontent.com/u/4738254?s=96&v=4",
      installationId: "123",
    });
    expect(body.githubUserId).toBeUndefined();
  });

  it("returns null account fields when signed out", async () => {
    mocks.getGitHubSession.mockResolvedValueOnce(null);

    const res = await GET();
    const body = await res.json();

    expect(body).toEqual({
      signedIn: false,
      githubLogin: null,
      githubAvatarUrl: null,
      installationId: null,
    });
  });
});
