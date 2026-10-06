import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeDeploymentState: vi.fn(),
}));

vi.mock("../../src/lib/deployment-state", () => ({
  writeDeploymentState: mocks.writeDeploymentState,
}));

import { deployCommand } from "../../src/cli/commands/deploy";

const SOURCE_REF = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();

describe("aomi deploy Project routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("routes by Project identity without forwarding a client-selected platform", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        ok: true,
        deployment: {
          id: "deployment-1",
          status: "preflight",
          source: { repository_link: "alice/trading-bot" },
          platform: { platform: "trading-platform-x", apps: [] },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await deployCommand({
      "backend-url": "https://api.test/",
      "activation-token": "activation-token",
      "project-id": "42",
      platform: "wrong-client-platform",
      commit: SOURCE_REF,
      preflight: true,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/projects/42/deploy");
    expect(JSON.parse(String(init.body))).toEqual({
      source_ref: SOURCE_REF,
      preflight: true,
    });
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer activation-token",
    );
    expect(mocks.writeDeploymentState).not.toHaveBeenCalled();
  });

  it("persists the backend-resolved platform after deployment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          deployment: {
            id: "deployment-2",
            status: "pr_created",
            source: { repository_link: "alice/trading-bot" },
            platform: {
              platform: "trading-platform-x",
              apps: [{ name: "trader", release_tag: "trader-v1" }],
            },
          },
        }),
      ),
    );

    await deployCommand({
      "backend-url": "https://api.test",
      "activation-token": "activation-token",
      "project-id": "42",
      platform: "wrong-client-platform",
      commit: SOURCE_REF,
    });

    expect(mocks.writeDeploymentState).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "deployment-2",
        platform: "trading-platform-x",
        projectId: 42,
      }),
    );
  });
});
