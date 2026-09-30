import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(),
  handle: vi.fn(),
}));
vi.mock("@build/server/bff/auth", () => ({ authorize: mocks.authorize }));
vi.mock("@build/server/bff/backend", () => ({
  backendClient: async () => ({
    listUserGitHubAppInstallations: mocks.list,
  }),
}));
vi.mock("@build/server/bff/failures", () => ({
  buildFailures: { handle: mocks.handle },
}));
import { githubAppInstallationsRoute } from "./github-app";
const get = (search = "") =>
  new Request(`https://build.test/api/bff/deployments/github-app${search}`);
const report = { status: "ok", repositories: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ session: { githubUserId: "owner" } });
  mocks.list.mockResolvedValue(report);
  mocks.handle.mockReturnValue({
    response: new Response(null, { status: 502 }),
  });
});
describe("GitHub App installations BFF", () => {
  it("takes the builder identity only from the session and ignores query identities", async () => {
    const response = await githubAppInstallationsRoute(
      get("?platform=community&github_user_id=attacker&githubUserId=attacker"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(report);
    expect(mocks.list).toHaveBeenCalledWith({
      githubUserId: "owner",
    });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request));
  });
  it("rejects unauthenticated requests before any backend operation", async () => {
    mocks.authorize.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect((await githubAppInstallationsRoute(get())).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("hands backend failures to the shared failure pipeline", async () => {
    const error = new Error("list_user_github_app_installations failed (404)");
    mocks.list.mockRejectedValue(error);
    const response = await githubAppInstallationsRoute(get("?platform=x"));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Couldn’t check GitHub repository access. Try again.",
    });
    expect(mocks.handle).toHaveBeenCalledWith({
      source: "launch",
      error,
      context: {
        routeFamily: "/api/bff/deployments/github-app",
        operation: "deployment.github_app_installations",
        method: "GET",
      },
    });
  });
});
