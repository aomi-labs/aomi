// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAgentsRoute } from "./routes";
import { getGitHubSession } from "./harness";

function sourceWithAgents(id: number, agents: Array<Record<string, unknown>>) {
  return Response.json({
    projects: [
      {
        id,
        installation_id: 555,
        repository_link: "alice/channel",
        platform_name: "community",
        agents,
      },
    ],
  });
}

describe("projectAgentsRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("returns runtime status for an owned project in one batch", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sourceWithAgents(1578, [{ id: 77, name: "my-channel" }]),
      )
      .mockResolvedValueOnce(
        Response.json({
          agents: [
            {
              id: 77,
              name: "my-channel",
              is_active: true,
              loaded: false,
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await projectAgentsRoute(
      new Request(
        "http://localhost:3000/api/build/deployments/agents?projectId=1578",
      ),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      projectId: 1578,
      state: "pending",
      agents: [
        {
          id: 77,
          name: "my-channel",
          is_active: true,
          loaded: false,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
