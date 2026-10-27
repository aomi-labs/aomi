// @vitest-environment node
import { describe, expect, it } from "vitest";

import { fakeManager } from "./testing";

describe("manager projects", () => {
  it("scaffolds from the caller-provided template and maps the project", async () => {
    const { client, sent } = fakeManager({
      ok: true,
      project: {
        id: 99,
        installation_id: 555,
        repository_id: 111,
        repository_link: "https://github.com/alice/alice-bot",
        platform_id: 3,
        owner_builder_id: 222,
        created_at: 1,
        updated_at: 2,
      },
    });

    const project = await client.scaffold({
      platform: "playground",
      installationId: 555,
      repoName: "my-bot",
      templateRepo: "alice/template-bot",
      githubUserId: "42",
    });

    expect(sent[0]).toMatchObject({
      method: "POST",
      url: "/api/integrations/github-app/platforms/playground/projects/create-from-template",
      body: {
        installation_id: 555,
        template_repo: "alice/template-bot",
        repo_name: "my-bot",
        github_user_id: "42",
        private: false,
      },
    });
    expect(project).toEqual({
      id: 99,
      installationId: 555,
      repositoryId: 111,
      repositoryLink: "https://github.com/alice/alice-bot",
      platformId: 3,
      ownerBuilderId: 222,
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("reads a project's apps and maps them to camelCase", async () => {
    const { client, sent } = fakeManager({
      project: { id: 99, installation_id: 555 },
      platform: "playground",
      apps: [
        {
          id: 5,
          name: "my-bot",
          label: "My Bot",
          is_active: true,
          is_public: true,
          project_id: 99,
          app_release_tag: "apps-555-r1-my-bot-abc1234",
          target_tags: ["staging"],
          loaded: true,
        },
      ],
    });

    const result = await client.listUserProjectApps({ githubUserId: "42", projectId: 99 });

    expect(sent[0].url).toBe("/api/integrations/github-app/user/projects/99/apps?github_user_id=42");
    expect(result.platform).toBe("playground");
    expect(result.apps[0]).toEqual({
      id: 5,
      name: "my-bot",
      label: "My Bot",
      platform: null,
      isActive: true,
      isPublic: true,
      projectId: 99,
      appReleaseTag: "apps-555-r1-my-bot-abc1234",
      artifactReady: false,
      targetTags: ["staging"],
      loaded: true,
      pricing: null,
    });
  });

  it("rejects a non-positive project id before anything is sent", async () => {
    const { client, fetch } = fakeManager({});
    await expect(client.listUserProjectApps({ githubUserId: "42", projectId: 0 })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      message: "projectId must be a positive integer",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
