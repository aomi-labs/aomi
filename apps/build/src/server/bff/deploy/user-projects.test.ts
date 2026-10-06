// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { clearLaunchReadCache, userProjectsRoute } from "./routes";

vi.mock("@aomi-labs/account", () => ({
  portalService: () => ({
    mint: vi.fn(async () => ({
      accessToken: "service-token",
      expiresAt: Date.now() + 300_000,
    })),
  }),
}));

const getGitHubSession = vi.fn();
vi.mock("@build/server/cookies/github", () => ({
  getGitHubSession: () => getGitHubSession(),
  getGitHubCliSessionFromRequest: () => getGitHubSession(),
}));

function req(platform?: string, projectId?: string) {
  const url = new URL("http://localhost:3000/api/bff/launch/projects");
  if (platform) url.searchParams.set("platform", platform);
  if (projectId) url.searchParams.set("projectId", projectId);
  return new Request(url);
}

function sourceRow(id: number) {
  return {
    id,
    installation_id: 555,
    repository_link: `https://github.com/alice/bot-${id}`,
    github_user_id: "42",
    platform_name: "community",
    apps: [],
  };
}

describe("userProjectsRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    getGitHubSession.mockReset();
    // The projects read cache is module state — don't leak one test's list
    // into the next.
    clearLaunchReadCache();
  });

  it("401s when there is no GitHub session", async () => {
    getGitHubSession.mockResolvedValueOnce(null);
    const res = await userProjectsRoute(req());
    expect(res.status).toBe(401);
  });

  it("returns the session user's projects, scoped to the cookie's github_user_id", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn(async () =>
      Response.json({
        projects: [
          {
            id: 99,
            installation_id: 555,
            repository_link: "https://github.com/alice/bot",
            github_user_id: "42",
            platform_name: "community",
            apps: [
              {
                id: 5,
                name: "bot",
                is_active: true,
                loaded: true,
                app_release_tag: "apps-555-r1-bot-abc",
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await userProjectsRoute(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubLogin).toBe("alice");
    expect(body.projects[0]).toMatchObject({
      id: 99,
      installationId: 555,
      apps: [{ id: 5, name: "bot", isActive: true, loaded: true }],
    });

    // The backend call is scoped to the session's github_user_id.
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/api/integrations/github-app/user/projects?github_user_id=42",
    );
    expect(String(url)).not.toContain("&platform=");
  });

  it("looks up an exact partner platform without a frontend list", async () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community");
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn(async () => Response.json({ projects: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await userProjectsRoute(req("somm.finance"));

    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "github_user_id=42&platform=somm.finance",
    );
  });

  it("preserves the manager's not-found status for an unknown platform", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "unknown platform `missing.partner`" },
          { status: 404 },
        ),
      ),
    );

    const res = await userProjectsRoute(req("missing.partner"));

    expect(res.status).toBe(404);
  });

  it("reads the exact owned Project without leaking the shell platform", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn(async () => Response.json(sourceRow(99)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await userProjectsRoute(req("community", "99"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe(99);
    expect(body.githubLogin).toBe("alice");

    const managerUrl = String(fetchMock.mock.calls[0][0]);
    expect(managerUrl).toContain(
      "/api/integrations/github-app/user/projects/99?github_user_id=42",
    );
    expect(managerUrl).not.toContain("projectId");
    expect(managerUrl).not.toContain("platform");
  });

  // The manager's detail read omits the live SDK summary its list read
  // carries; the BFF fills it from the list so the page and the index agree.
  it("stamps the list's live SDK onto a detail read that lacks it", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const liveApp = {
      id: 2937808,
      name: "bot",
      is_active: true,
      loaded: true,
      app_release_tag: "apps-555-r1-bot-abc",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/projects/1663?")
        ? Response.json({
            ...sourceRow(1663),
            apps: [liveApp],
            sdk_version: null,
            sdk_versions: [],
            configuration: { status: "invalid", checked_revision: "abc" },
          })
        : Response.json({
            projects: [
              {
                ...sourceRow(1663),
                apps: [liveApp],
                sdk_version: "5.0.0",
                sdk_versions: ["5.0.0"],
              },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await userProjectsRoute(req(undefined, "1663"));
    expect(res.status).toBe(200);
    const [project] = (await res.json()).projects;
    expect(project).toMatchObject({
      id: 1663,
      sdkVersion: "5.0.0",
      sdkVersions: ["5.0.0"],
      configuration: { status: "invalid" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/api/integrations/github-app/user/projects?github_user_id=42",
    );
  });

  it("keeps a detail read's own SDK stamp without a list read", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn(async () =>
      Response.json({
        ...sourceRow(1663),
        apps: [
          {
            id: 2937808,
            name: "bot",
            is_active: true,
            loaded: true,
            app_release_tag: "apps-555-r1-bot-abc",
          },
        ],
        sdk_version: "5.1.0",
        sdk_versions: ["5.1.0"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await userProjectsRoute(req(undefined, "1663"));
    expect((await res.json()).projects[0].sdkVersion).toBe("5.1.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("400s on a malformed projectId", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const res = await userProjectsRoute(req(undefined, "not-a-number"));
    expect(res.status).toBe(400);
  });

  it("caches list and detail reads independently and refetches once cleared", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/projects/99?")
        ? Response.json(sourceRow(99))
        : Response.json({ projects: [sourceRow(99)] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await userProjectsRoute(req());
    const narrowed = await userProjectsRoute(req(undefined, "99"));
    await userProjectsRoute(req(undefined, "99"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((await narrowed.json()).projects).toHaveLength(1);

    // Mutations clear the cache so post-deploy reloads see fresh projects.
    clearLaunchReadCache();
    await userProjectsRoute(req());
    await userProjectsRoute(req(undefined, "99"));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
