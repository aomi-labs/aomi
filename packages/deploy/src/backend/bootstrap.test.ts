// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackendClient } from "../src/backend";
import { DeployError } from "../src/errors";
import type { AuditEvent } from "../src/types";

function client(opts?: {
  activationToken?: string;
  adminBearer?: string;
  onAudit?: (event: AuditEvent) => void;
}) {
  return new BackendClient({
    aomi: {
      backendUrl: "https://staging-api.example.com/",
      activationToken: opts?.activationToken,
      adminBearer: opts?.adminBearer,
    },
    onAudit: opts?.onAudit,
  });
}

function jsonOnce(fetchMock: ReturnType<typeof vi.fn>, body: unknown) {
  fetchMock.mockResolvedValueOnce(Response.json(body));
}

describe("BackendClient bootstrap — tokens", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mints a platform token with the admin bearer", async () => {
    jsonOnce(fetchMock, { id: 12, token: "plaintext-once", scope: "platform" });
    const audits: AuditEvent[] = [];
    const result = await client({
      adminBearer: "admin-jwt",
      onAudit: (e) => audits.push(e),
    }).mintToken({ platform: "playground", scope: "platform", actor: "ops" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://staging-api.example.com/api/platforms/playground/tokens",
    );
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer admin-jwt",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      scope: "platform",
    });
    expect(result).toEqual({
      id: 12,
      token: "plaintext-once",
      scope: "platform",
    });
    expect(audits).toEqual([
      expect.objectContaining({
        action: "mint_token",
        platform: "playground",
        scope: "platform",
        actor: "ops",
      }),
    ]);
  });

  it("mints an app token (app_id in body, activation token allowed)", async () => {
    jsonOnce(fetchMock, { id: 13, token: "app-tok", scope: "app" });
    await client({ activationToken: "plat-tok" }).mintToken({
      platform: "playground",
      scope: "app",
      appId: 42,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer plat-tok",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      scope: "app",
      app_id: 42,
    });
  });

  it("per-call bearer override wins over configured tokens", async () => {
    jsonOnce(fetchMock, { id: 1, token: "t", scope: "platform" });
    await client({ adminBearer: "configured" }).mintToken({
      platform: "playground",
      scope: "platform",
      bearer: "override-jwt",
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer override-jwt",
    });
  });

  it("rejects scope app without appId before calling the backend", async () => {
    await expect(
      client({ adminBearer: "a" }).mintToken({
        platform: "playground",
        scope: "app",
      }),
    ).rejects.toBeInstanceOf(DeployError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects minting when no privileged bearer is configured", async () => {
    await expect(
      client().mintToken({ platform: "playground", scope: "platform" }),
    ).rejects.toBeInstanceOf(DeployError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists and revokes tokens", async () => {
    jsonOnce(fetchMock, [
      {
        id: 7,
        scope: "platform",
        app_id: null,
        token_hash_prefix: "deadbeef",
        created_at: "2026-06-23T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
        apps_usage: null,
        platform_usage: "playground",
      },
    ]);
    const list = await client({ activationToken: "plat-tok" }).listTokens({
      platform: "playground",
    });
    expect(list[0]).toMatchObject({
      id: 7,
      scope: "platform",
      tokenHashPrefix: "deadbeef",
      platformUsage: "playground",
    });

    jsonOnce(fetchMock, true);
    const ok = await client({ adminBearer: "admin-jwt" }).revokeToken({
      platform: "playground",
      id: 7,
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(
      "https://staging-api.example.com/api/platforms/playground/tokens/7",
    );
    expect((init as RequestInit).method).toBe("DELETE");
  });
});

describe("BackendClient bootstrap — projects", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const projectBody = {
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
  };

  it("creates an installed project and maps to camelCase", async () => {
    jsonOnce(fetchMock, projectBody);
    const src = await client({ activationToken: "plat-tok" }).createProject({
      platform: "playground",
      repo: "alice/alice-bot",
      githubUserId: "222",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://staging-api.example.com/api/platforms/playground/projects",
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      repo: "alice/alice-bot",
      github_user_id: "222",
    });
    expect(src).toEqual({
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

  it("binds an installed source to the signed-in GitHub user when provided", async () => {
    jsonOnce(fetchMock, projectBody);
    await client({ activationToken: "plat-tok" }).createProject({
      platform: "playground",
      repo: "alice/alice-bot",
      githubUserId: "222",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      repo: "alice/alice-bot",
      github_user_id: "222",
    });
  });

  it("scaffolds from the caller-provided template and maps the source", async () => {
    jsonOnce(fetchMock, projectBody);
    const src = await client({ activationToken: "plat-tok" }).scaffold({
      platform: "playground",
      installationId: 555,
      repoName: "my-bot",
      templateRepo: "alice/template-bot",
      githubUserId: "42",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://staging-api.example.com/api/integrations/github-app/platforms/playground/projects/create-from-template",
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      installation_id: 555,
      template_repo: "alice/template-bot",
      repo_name: "my-bot",
      github_user_id: "42",
      private: false,
    });
    expect(src.id).toBe(99);
  });
});

describe("BackendClient bootstrap — apps", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads a project's apps and maps to camelCase", async () => {
    jsonOnce(fetchMock, {
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
    const result = await client({
      activationToken: "plat-tok",
    }).listUserProjectApps({ githubUserId: "42", projectId: 99 });
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://staging-api.example.com/api/integrations/github-app/user/projects/99/apps?github_user_id=42",
    );
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
});
