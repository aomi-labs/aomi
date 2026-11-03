// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGitHubSession, route } from "./harness";
const remove = route("/api/build/projects", "DELETE");
const request = (origin = "http://localhost:3000") =>
  new Request(
    "http://localhost:3000/api/build/projects?projectId=1671&githubUserId=attacker",
    { method: "DELETE", headers: { origin } },
  );
describe("project deletion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    getGitHubSession.mockReset();
  });
  it("requires GitHub sign-in", async () => {
    getGitHubSession.mockResolvedValue(null);
    expect((await remove(request())).status).toBe(401);
  });
  it("rejects a cross-origin deletion", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await remove(request("https://evil.example"))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses the signed-in identity, never the caller's query identity", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    expect((await remove(request())).status).toBe(204);
    expect(String(fetch.mock.calls[0][0])).toContain(
      "/user/projects/1671?github_user_id=42",
    );
  });
  it("preserves an ownership rejection from Manager", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "project not found" }, { status: 404 }),
      ),
    );
    expect((await remove(request())).status).toBe(404);
  });
});
