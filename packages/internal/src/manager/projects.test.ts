// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fakeManager } from "./testing";

describe("manager projects", () => {
  it("reads a project's agents and maps them to camelCase", async () => {
    const { client, sent } = fakeManager({
      project: { id: 99, installation_id: 555 },
      platform: "playground",
      agents: [
        {
          id: 5,
          name: "my-channel",
          label: "My Channel",
          is_active: true,
          is_public: true,
          project_id: 99,
          target_tags: ["staging"],
          loaded: true,
        },
      ],
    });

    const result = await client.listUserProjectAgents({
      githubUserId: "42",
      projectId: 99,
    });

    expect(sent[0].url).toBe(
      "/api/integrations/github-app/user/projects/99/agents?github_user_id=42",
    );
    expect(result.platform).toBe("playground");
    expect(result.agents[0]).toEqual({
      id: 5,
      name: "my-channel",
      label: "My Channel",
      platform: null,
      isActive: true,
      isPublic: true,
      projectId: 99,
      artifactReady: false,
      targetTags: ["staging"],
      loaded: true,
      pricing: null,
    });
  });

  it("rejects a non-positive project id before anything is sent", async () => {
    const { client, fetch } = fakeManager({});
    await expect(
      client.listUserProjectAgents({ githubUserId: "42", projectId: 0 }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: "projectId must be a positive integer",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("deletes the exact project as the session user without a visibility grant", async () => {
  const { client, sent } = fakeManager(new Response(null, { status: 204 }));
  await expect(
    client.deleteUserProject({ projectId: 1671, githubUserId: "42" }),
  ).resolves.toBeUndefined();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    method: "DELETE",
    url: "/api/integrations/github-app/user/projects/1671?github_user_id=42",
  });
});
