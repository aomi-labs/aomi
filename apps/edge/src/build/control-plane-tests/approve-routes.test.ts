// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { deployRoute, deploymentApproveRoute, deploymentGrandfatherRoute } from "./routes";
import { getGitHubSession } from "./harness";

const APPROVER = { githubUserId: "61880411", githubLogin: "arixoneth" };
const BUILDER = { githubUserId: "42", githubLogin: "alice" };

function cli(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { authorization: "Bearer cli-session", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function activation(status: string) {
  return Response.json(
    {
      ok: true,
      activation: {
        status,
        platform: "community",
        target: { kind: "deployment", value: "dep_1" },
        apps: [{ application_id: 77, name: "my-bot", release_tag: "apps-555-r1-my-bot-abc" }],
      },
    },
    { status: 202 },
  );
}

describe("app release approval", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("keeps CLI deploy, approve and grandfather to approvers", async () => {
    getGitHubSession.mockResolvedValue(BUILDER);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const deploy = await deployRoute(false)(
      cli("/api/build/deployments/deploy", { projectId: 42, sourceRef: "abc1234" }),
    );
    const approve = await deploymentApproveRoute(cli("/api/build/deployments/approve", { deploymentId: "dep_1" }));
    const grandfather = await deploymentGrandfatherRoute(cli("/api/build/deployments/grandfather", {}));

    expect([deploy.status, approve.status, grandfather.status]).toEqual([403, 403, 403]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records the approver's login and returns the activation", async () => {
    getGitHubSession.mockResolvedValue(APPROVER);
    const fetchMock = vi.fn().mockResolvedValue(activation("activating"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentApproveRoute(
      cli("/api/build/deployments/approve", { deploymentId: "dep_1", apps: ["my-bot"] }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.promote.status).toBe("promoted");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:8080/api/platforms/community/deployments/dep_1/approve",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body)).toEqual({ approved_by: "arixoneth", apps: ["my-bot"] });
  });
});
