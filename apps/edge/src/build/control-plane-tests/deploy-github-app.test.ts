import { beforeEach, describe, expect, it, vi } from "vitest";

import { EdgeError } from "../../kernel/errors";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../auth", () => ({ authorize: mocks.authorize }));
vi.mock("../manager-client", async (original) => ({
  ...(await original<typeof import("../manager-client")>()),
  managerClient: async () => ({
    listUserGitHubAppInstallations: mocks.list,
  }),
}));

import { githubAppInstallationsRoute } from "./routes";
const get = (search = "") =>
  new Request(`https://build.test/api/build/deployments/github-app${search}`);
const report = { status: "ok", repositories: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ session: { githubUserId: "owner" } });
  mocks.list.mockResolvedValue(report);
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
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), expect.anything(), {});
  });
  it("rejects unauthenticated requests before any backend operation", async () => {
    mocks.authorize.mockRejectedValue(new EdgeError(401, "unauthenticated"));
    expect((await githubAppInstallationsRoute(get())).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("hands backend failures to the shared failure pipeline", async () => {
    const error = new Error("list_user_github_app_installations failed (404)");
    mocks.list.mockRejectedValue(error);
    const response = await githubAppInstallationsRoute(get("?platform=x"));
    // An unidentified failure is the edge's own 500, with the UI's copy.
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Couldn’t check GitHub repository access. Try again.",
    });
  });
});
