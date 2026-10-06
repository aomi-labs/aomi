import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  start: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@build/server/bff/auth", () => ({ authorize: mocks.authorize }));
vi.mock("@build/server/bff/backend", () => ({
  backendClient: async () => ({
    startProjectDeploymentAttempt: mocks.start,
    projectDeploymentAttempts: mocks.list,
    cancelProjectDeploymentAttempt: mocks.cancel,
  }),
}));
vi.mock("@build/server/bff/failures", () => ({
  buildFailures: {
    handle: () => ({ response: new Response(null, { status: 502 }) }),
  },
}));
import { deploymentAttemptsRoute } from "./attempts";
const post = (body: unknown) =>
  new Request("https://build.test/api/bff/launch/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ session: { githubUserId: "owner" } });
  mocks.start.mockResolvedValue({ attempt: { id: 1 } });
  mocks.cancel.mockResolvedValue({ ok: true });
});
describe("attempt BFF authorization", () => {
  it("takes ownership identity only from the authenticated session", async () => {
    const response = await deploymentAttemptsRoute(
      post({
        action: "start",
        projectId: 7,
        branch: "fix",
        githubUserId: "attacker",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith({
      projectId: 7,
      githubUserId: "owner",
      branch: "fix",
    });
    expect(mocks.authorize).toHaveBeenCalledWith(expect.any(Request), {
      write: true,
      cliScope: "deploy",
    });
  });
  it("rejects unauthenticated requests before any backend operation", async () => {
    mocks.authorize.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect(
      (await deploymentAttemptsRoute(post({ action: "start", projectId: 7 })))
        .status,
    ).toBe(401);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("carries the project and run together when cancelling", async () => {
    await deploymentAttemptsRoute(
      post({ action: "cancel", projectId: 7, runId: 33 }),
    );
    expect(mocks.cancel).toHaveBeenCalledWith({
      projectId: 7,
      runId: 33,
      githubUserId: "owner",
    });
    expect(
      (
        await deploymentAttemptsRoute(
          post({ action: "cancel", projectId: 7, runId: -1 }),
        )
      ).status,
    ).toBe(400);
  });
});
