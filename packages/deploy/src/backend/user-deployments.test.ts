// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackendClient } from "../backend";

let client: BackendClient;

beforeEach(() => {
  client = new BackendClient({
    aomi: {
      backendUrl: "https://staging-api.example.com",
      activationToken: "service-token",
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listUserDeployments", () => {
  it("maps the global feed and sends its cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          deployments: [
            {
              deployment_id: "dep_1_rabc_def",
              project_id: 42,
              repository_link: "alice/app",
              created_at: 100,
              release_tags: [],
              apps: [],
            },
          ],
          next_cursor: { created_at: 100, id: 7 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.listUserDeployments({
      githubUserId: "123",
      platform: "world-market-apps",
      limit: 50,
      cursor: { createdAt: 200, id: 9 },
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain(
      "/api/integrations/github-app/user/deployments?",
    );
    expect(String(url)).toContain("platform=world-market-apps");
    expect(String(url)).toContain("cursor_created_at=200");
    expect(String(url)).toContain("cursor_id=9");
    expect(result).toEqual({
      deployments: [
        expect.objectContaining({
          deploymentId: "dep_1_rabc_def",
          projectId: 42,
          repositoryLink: "alice/app",
          createdAt: 100,
        }),
      ],
      nextCursor: { createdAt: 100, id: 7 },
    });
  });
});
