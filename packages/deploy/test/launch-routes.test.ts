// @vitest-environment node
// Ported from apps/portal/src/server/bff/launch/routes.test.ts — same
// behaviors, but exercised through the createLaunchRoutes factory with
// injected client/session seams instead of portal module mocks.
import { afterEach, describe, expect, it, vi } from "vitest";

import { BackendClient } from "../src/backend";
import { createLaunchRoutes } from "../src/bff/launch-routes";
import type { GitHubSession } from "../src/bff/auth";

const BACKEND = "http://127.0.0.1:8080";

const session = vi.fn<() => Promise<GitHubSession | null>>(async () => null);

function routes() {
  return createLaunchRoutes({
    client: () =>
      new BackendClient({
        aomi: { backendUrl: BACKEND, activationToken: "service-token" },
      }),
    session: () => session(),
  });
}

function writeReq(path: string, body: unknown) {
  return new Request(`http://localhost:3000/api/bff/launch/${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function readReq(path: string, query = "") {
  return new Request(
    `http://localhost:3000/api/bff/launch/${path}${query ? `?${query}` : ""}`,
  );
}

function ownedProjects(id = 99, platformName = "community") {
  return Response.json({
    projects: [
      {
        id,
        installation_id: 555,
        repository_link: "alice/bot",
        platform_name: platformName,
        apps: [],
      },
    ],
  });
}

function activationProject(id = 99) {
  return Response.json({
    projects: [
      {
        id,
        installation_id: 555,
        repository_link: "alice/bot",
        platform_name: "community",
        apps: [
          {
            id: 77,
            name: "my-bot",
            app_release_tag: "apps-555-r1-my-bot-abc",
          },
        ],
      },
    ],
  });
}

/** Like `activationProject`, but with a `latestDeployment.platformRepo` so the
 *  required-secrets check has a manifest to read. */
function activationProjectWithRepo(platformRepo: string, id = 99) {
  return Response.json({
    projects: [
      {
        id,
        installation_id: 555,
        repository_link: "alice/bot",
        platform_name: "community",
        apps: [
          {
            id: 77,
            name: "my-bot",
            app_release_tag: "apps-555-r1-my-bot-abc",
          },
        ],
        latest_deployment: {
          platform_repo: platformRepo,
          created_at: 1,
          apps: [{ name: "my-bot", release_tag: "apps-555-r1-my-bot-abc" }],
        },
      },
    ],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  session.mockReset();
});

describe("createLaunchRoutes deploy/preflight", () => {
  it("propagates BackendError status codes (400-599)", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(123))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "deploy rejected" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", {
        projectId: 123,
        sourceRef: "abc1234def5678",
      }),
    );
    const body = await res.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "deploy rejected" });
  });

  it("preflight resolves the existing Project by repo and its immutable commit", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(123))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment: {
            id: "dep_555_rabc1234_deadbeef",
            source: {
              repository_link: "alice/bot",
              commit_hash: "abc1234def5678",
            },
            platform: { apps: [] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().preflight(
      writeReq("preflight", { installationId: "555", repo: "alice/bot" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repo).toBe("alice/bot");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${BACKEND}/api/integrations/github-app/user/projects?github_user_id=42`,
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${BACKEND}/api/projects/123/deploy`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ preflight: true }),
      }),
    );
  });

  it("real deploy rejects a repo-only request without a project id", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", { installationId: "555", repo: "alice/bot" }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deploys directly by projectId when the project identity is already known", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(777))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment: {
            id: "dep_999_rabc1234_deadbeef",
            source: {
              installation_id: 999,
              repository_link: "alice/bot",
            },
            platform: { apps: [] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", {
        projectId: 777,
        sourceRef: "abc1234def5678",
        installationId: "555",
        repo: "alice/bot",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ repo: "alice/bot", projectId: 777 });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${BACKEND}/api/projects/777/deploy`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"source_ref":"abc1234def5678"'),
      }),
    );
  });

  it("returns no activation targets for an incomplete deployment manifest", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(777))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment: {
            id: "dep_999_rabc1234_deadbeef",
            source: {
              repository_link: "alice/bot",
              commit_hash: "abc1234def5678",
            },
            platform: {
              apps: [
                { name: "complete", release_tag: "release-complete" },
                { name: "missing-release" },
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", {
        projectId: 777,
        sourceRef: "abc1234def5678",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.apps).toEqual([]);
    expect(body.releaseTags).toEqual([]);
  });

  it("deploys by Project identity without a client-selected platform", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(777, "somm.finance"))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment: {
            id: "dep_999_rabc1234_deadbeef",
            source: { repository_link: "alice/bot" },
            platform: { apps: [] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", { projectId: 777, sourceRef: "abc1234def5678" }),
    );

    expect(res.status).toBe(202);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      `${BACKEND}/api/projects/777/deploy`,
    );
  });

  it("404s a deploy for a project the session user does not own", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn().mockResolvedValueOnce(ownedProjects(1));
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", { projectId: 777, sourceRef: "abc1234def5678" }),
    );

    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects deploy requests when no source commit is supplied or resolved", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn().mockResolvedValueOnce(ownedProjects(777));
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(writeReq("deploy", { projectId: 777 }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("missing source commit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a request without projectId or repo before calling the backend", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", { installationId: "555" }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401s a deploy without a GitHub session", async () => {
    session.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", { projectId: 777, sourceRef: "abc1234def5678" }),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid repo before calling the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", { installationId: "555", repo: "not/a/repo" }),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 for non-BackendError exceptions", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().deploy(
      writeReq("deploy", {
        projectId: 123,
        sourceRef: "abc1234def5678",
      }),
    );
    // A thrown fetch becomes BackendError(status 0) — not a client 4xx.
    expect(res.status).toBe(502);
  });

  it("blocks cross-origin writes (CSRF guard)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ projectId: 123, sourceRef: "abc1234def5678" }),
    });
    const res = await routes().deploy(req);
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createLaunchRoutes redeploy", () => {
  it("reruns the latest deployment through the backend rerun endpoint", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(99))
      .mockResolvedValueOnce(
        Response.json({
          latest_deployment: {
            deployment_id: "dep_1",
            created_at: 1,
            platform_repo: "aomi-labs/community-apps",
            ci_run_id: "123456",
            ci_url:
              "https://github.com/aomi-labs/community-apps/actions/runs/123456",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment_id: "dep_1",
          commit_hash: "8819f32c4399ae75514b1f0605fef8cca75303bf",
          run_id: 123456,
          ci_url:
            "https://github.com/aomi-labs/community-apps/actions/runs/123456",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().redeploy(
      writeReq("redeploy", { projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      projectId: 99,
      platformRepo: "aomi-labs/community-apps",
      ciRunId: "123456",
    });
    // The rerun call goes to the Aomi backend, never to api.github.com.
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "/api/platforms/community/deployments/dep_1/rerun?github_user_id=42",
    );
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/api/integrations/github-app/user/projects/99/latest-deployment?github_user_id=42",
    );
  });

  it("refuses redeploy when the project has no backend-owned deployment yet", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(99))
      .mockResolvedValueOnce(Response.json({ latest_deployment: null }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().redeploy(
      writeReq("redeploy", { projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("No backend-owned deployment");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a backend rerun rejection instead of masking it", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(99))
      .mockResolvedValueOnce(
        Response.json({
          latest_deployment: {
            deployment_id: "dep_1",
            created_at: 1,
            platform_repo: "aomi-labs/community-apps",
            ci_run_id: "123456",
            ci_url:
              "https://github.com/aomi-labs/community-apps/actions/runs/123456",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error:
              "deployment `dep_1` has no rerunnable GitHub Actions run for commit `8819f32c` yet",
          },
          { status: 409 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().redeploy(
      writeReq("redeploy", { projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("no rerunnable GitHub Actions run");
  });
});

describe("createLaunchRoutes status", () => {
  it("propagates backend 404 instead of masking deployment status as pending", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "deployment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().status(
      new Request(
        "http://localhost:3000/api/bff/launch/status?deploymentId=dep_141780080_r2849901c35_af4f107b0331",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "deployment not found" });
  });

  it("returns the backend status payload untouched — no GitHub call", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        state: "building",
        deployment: {
          id: "dep_141780080_r2849901c35_af4f107b0331",
          platform: {
            repository: "aomi-labs/community-apps",
            commit_hash: "af4f107b0331d2ee04f7c8ffbddd823a75f35e0b",
            ci_status: "running",
            ci_url:
              "https://github.com/aomi-labs/community-apps/actions/runs/28048200284",
            apps: [
              {
                name: "playground-example",
                release_tag:
                  "apps-141780080-r2849901c35-playground-example-af4f107b0331",
              },
            ],
          },
        },
        ci: {
          status: "running",
          url: "https://github.com/aomi-labs/community-apps/actions/runs/28048200284",
          commit_hash: "af4f107b0331d2ee04f7c8ffbddd823a75f35e0b",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().status(
      readReq("status", "deploymentId=dep_141780080_r2849901c35_af4f107b0331"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state).toBe("building");
    expect(body.ci.status).toBe("running");
    // The backend deep-links the actual run URL; the BFF adds nothing.
    expect(body.ci.url).toContain("/actions/runs/28048200284");
    expect(body.releaseTags).toEqual([
      "apps-141780080-r2849901c35-playground-example-af4f107b0331",
    ]);
    // Exactly one backend call — the BFF never talks to api.github.com.
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("api.github.com");
  });
});

describe("createLaunchRoutes projects", () => {
  it("401s when there is no GitHub session", async () => {
    session.mockResolvedValueOnce(null);
    const res = await routes().projects(
      new Request("http://localhost:3000/api/bff/launch/projects"),
    );
    expect(res.status).toBe(401);
  });

  it("returns the session user's projects, scoped to the cookie's github_user_id", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
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

    const res = await routes().projects(
      new Request("http://localhost:3000/api/bff/launch/projects"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubLogin).toBe("alice");
    expect(body.projects[0]).toMatchObject({
      id: 99,
      installationId: 555,
      apps: [{ id: 5, name: "bot", isActive: true, loaded: true }],
    });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/api/integrations/github-app/user/projects?github_user_id=42",
    );
    expect(String(url)).not.toContain("platform=");
  });
});

describe("createLaunchRoutes runtime apps", () => {
  it("returns one project's live runtime statuses", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedProjects(99))
      .mockResolvedValueOnce(
        Response.json({
          project: { id: 99, platform_name: "community", apps: [] },
          platform: "community",
          apps: [
            {
              id: 5,
              name: "bot",
              is_active: true,
              loaded: true,
              app_release_tag: "release-2",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().apps(readReq("apps", "projectId=99"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      projectId: 99,
      state: "live",
      apps: [
        {
          id: 5,
          name: "bot",
          is_active: true,
          loaded: true,
          app_release_tag: "release-2",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid project id before backend calls", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().apps(readReq("apps", "projectId=nope"));

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createLaunchRoutes activation security", () => {
  it("rejects activate without a GitHub session before backend calls", async () => {
    session.mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().activate(
      writeReq("activate", {
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires activate projectId and app/tag pairs", async () => {
    session.mockResolvedValue({ githubUserId: "42", githubLogin: "alice" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (
        await routes().activate(
          writeReq("activate", {
            apps: ["my-bot"],
            releaseTags: ["apps-555-r1-my-bot-abc"],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await routes().activate(
          writeReq("activate", {
            projectId: 99,
            releaseTags: ["apps-555-r1-my-bot-abc"],
          }),
        )
      ).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relays Manager's rejection for an unmatched activate app/tag pair", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationProjectWithRepo("aomi-labs/community"))
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(Response.json({ error: "release not found" }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().activate(
      writeReq("activate", {
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-wrong"],
      }),
    );

    // The sequence is intentionally Project lookup → secret state → GitHub
    // release manifest → Project activation; keep this assertion next to the
    // Manager-rejection regression.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(res.status).toBe(404);
  });

  it("409s when a required secret is unfilled", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationProjectWithRepo("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(
        Response.json({
          by_app: { "my-bot": ["$SECRET:APP:my-bot::MY_BOT_API_KEY"] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          assets: [
            { name: "manifest.json", url: "https://api.github.com/asset/1" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          plugins: {
            "my-bot": {
              file: "libmybot.dylib",
              sha256: "x",
              secrets: [
                { name: "MY_BOT_API_KEY", description: "d", required: true },
                {
                  name: "MY_BOT_SECRET_KEY",
                  description: "d",
                  required: true,
                },
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().activate(
      writeReq("activate", {
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "missing required secrets",
      missing: { "my-bot": ["MY_BOT_SECRET_KEY"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("activates when the release manifest declares no secrets for the app", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationProjectWithRepo("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, activation: { apps: [] } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().activate(
      writeReq("activate", {
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("activates an owned app/tag pair", async () => {
    session.mockResolvedValueOnce({ githubUserId: "42", githubLogin: "alice" });
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationProject())
      .mockResolvedValueOnce(
        Response.json({
          latest_deployment: {
            platform_repo: "aomi-labs/community",
            created_at: 1,
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, activation: { apps: [] } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await routes().activate(
      writeReq("activate", {
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        release_tags: ["apps-555-r1-my-bot-abc"],
        apps: ["my-bot"],
      }),
    });
  });
});
