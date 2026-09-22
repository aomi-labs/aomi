// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deploymentDeactivateRoute,
  deploymentFeedRoute,
  deploymentRecordsRoute,
  deploymentPromoteRoute,
  deploymentSecretsRoute,
  deploymentSecretsWriteRoute,
  clearLaunchReadCache,
  activateLaunchRoute,
  createLaunchRepoRoute,
  launchAppsRoute,
  launchDeployRoute,
  launchSdkStatusRoute,
  launchStatusRoute,
  redeployLaunchRoute,
  requiredSecretsRoute,
} from "./routes";

const telemetry = vi.hoisted(() => ({
  capture: vi.fn(),
  log: vi.fn(),
}));

// Spies on telemetry while keeping the REAL response serialization.
//
// This used to hand-roll `Response.json({ error })`, which quietly diverged
// from production the moment the failure contract grew: every route test kept
// passing while the real BFF returned fields the double never produced. Route
// tests are the only place that response shape is asserted, so the double must
// not own it — delegate to `routeFailure` and let it emit whatever production
// emits.
vi.mock("@build/server/bff/failures", async () => {
  const { classifyFailure, identifyFailure, routeFailure } =
    await import("@aomi-labs/bff-observability");
  return {
    buildFailures: {
      handle: (input: Parameters<typeof identifyFailure>[0]) => {
        const decision = classifyFailure(identifyFailure(input));
        const eventContext = {
          ...decision.context,
          status: decision.responseStatus,
          ...(decision.upstream ? { upstream: decision.upstream } : {}),
          ...(decision.upstreamStatus !== undefined
            ? { upstreamStatus: decision.upstreamStatus }
            : {}),
        };
        if (decision.action === "issue") {
          telemetry.capture(decision.error, eventContext);
        } else if (decision.action === "log") {
          telemetry.log(eventContext);
        }
        return routeFailure(decision, "build-bff");
      },
    },
  };
});

vi.mock("@aomi-labs/account", () => ({
  portalService: () => ({
    mint: vi.fn(async () => ({
      accessToken: "service-token",
      expiresAt: Date.now() + 300_000,
    })),
  }),
}));

beforeEach(() => {
  clearLaunchReadCache();
  telemetry.capture.mockReset();
  telemetry.log.mockReset();
});

const getGitHubSession = vi.fn();
vi.mock("@build/server/cookies/github", () => ({
  getGitHubSession: () => getGitHubSession(),
  getGitHubCliSessionFromRequest: (request: Request) =>
    request.headers.get("authorization") === "Bearer cli-session"
      ? getGitHubSession()
      : null,
}));

function writeReq(body: unknown) {
  return new Request("http://localhost:3000/api/bff/launch/redeploy", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function cliWriteReq(path: string, body: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer cli-session",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** The listUserProjects response granting the signed-in user these source ids. */
function ownedSources(...ids: number[]) {
  return Response.json({
    projects: ids.map((id) => ({
      id,
      installation_id: 555,
      repository_link: "alice/bot",
      platform_name: "community",
      apps: [{ id: 77, name: "my-bot" }],
    })),
  });
}

/** An owned project bound to a specific platform (partner scope). */
function ownedBoundProject(id: number, platformName: string) {
  return Response.json({
    projects: [
      {
        id,
        installation_id: 555,
        repository_link: "alice/bot",
        platform_name: platformName,
        apps: [{ id: 77, name: "my-bot" }],
      },
    ],
  });
}

function sourceWithApps(id: number, apps: Array<Record<string, unknown>>) {
  return Response.json({
    projects: [
      {
        id,
        installation_id: 555,
        repository_link: "alice/bot",
        platform_name: "community",
        apps,
      },
    ],
  });
}

/** The DB promotion-records response for one app (the promote authz source). */
function appRecords(...deploymentIds: string[]) {
  return Response.json({
    app: "my-bot",
    current_release_tag: null,
    records: deploymentIds.map((deployment_id) => ({
      deployment_id,
      release_tag: `${deployment_id}-tag`,
      actor: null,
      created_at: 0,
      sdk_version: "3.0.1",
      current: false,
    })),
  });
}

/** Same shape as `appRecords`, but with an explicit release tag — used to
 *  derive the promote secret-gate's (app, releaseTag) pairs from the DB
 *  promotion records (the `projectDeploymentPairs` call). */
function appRecordsWithTag(deploymentId: string, releaseTag: string) {
  return Response.json({
    app: "my-bot",
    current_release_tag: null,
    records: [
      {
        deployment_id: deploymentId,
        release_tag: releaseTag,
        actor: null,
        created_at: 0,
        sdk_version: "3.0.1",
        current: false,
      },
    ],
  });
}

function activationSource(id = 99) {
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

function projectDeployments() {
  return Response.json({
    deployments: [
      {
        deployment_id: "dep_1",
        project_id: 99,
        repository_link: "alice/bot",
        created_at: 1,
        release_tags: ["apps-555-r1-my-bot-abc"],
        apps: [{ name: "my-bot", release_tag: "apps-555-r1-my-bot-abc" }],
      },
    ],
  });
}

/** Exact Project-scoped candidate response: unlike deployment_records it is
 * present before first promotion and carries the release pair for the secret
 * UX gate. */
function candidateDeployment(
  deploymentId: string,
  releaseTag = "apps-555-r1-my-bot-abc",
) {
  return Response.json({
    deployment: {
      deployment_id: deploymentId,
      project_id: 99,
      platform_repo: "aomi-labs/my-bot-app",
      created_at: 1,
      apps: [{ name: "my-bot", release_tag: releaseTag }],
    },
  });
}

/** Like `activationSource`, but shaped like the real `listUserProjects`
 *  response: `latest_deployment` is always null there (the backend is lazy
 *  for the list). Pair with `latestDeploymentResponse(platformRepo)` to stub
 *  the per-source detail endpoint the required-secrets check now reads. */
function activationSourceWithRepo(_platformRepo: string, id = 99) {
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
        latest_deployment: null,
      },
    ],
  });
}

/** The `getUserProjectLatestDeployment` detail-endpoint response —
 *  the real source of `platformRepo` in production. */
function latestDeploymentResponse(platformRepo: string) {
  return Response.json({
    latest_deployment: {
      platform_repo: platformRepo,
      created_at: 1,
      apps: [{ name: "my-bot", release_tag: "apps-555-r1-my-bot-abc" }],
    },
  });
}

describe("createLaunchRepoRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("creates the project in the explicitly selected partner platform", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        ok: true,
        project: {
          id: 123,
          installation_id: 555,
          repository_id: 999,
          repository_link: "alice/bot",
          platform_id: 8,
          owner_builder_id: 42,
          created_at: 1,
          updated_at: 1,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await createLaunchRepoRoute(
      new Request("http://localhost:3000/api/bff/launch/create", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: "somm.finance",
          installationId: "555",
          repoName: "bot",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/api/integrations/github-app/platforms/somm.finance/projects/create-from-template",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("CLI bearer scope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("does not authorize browser-only secret or promotion writes", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });

    const secrets = await deploymentSecretsWriteRoute(
      cliWriteReq("/api/bff/deployments/secrets", {
        app: "my-bot",
        projectId: 42,
        secrets: { API_KEY: "secret" },
      }),
    );
    const promote = await deploymentPromoteRoute(
      cliWriteReq("/api/bff/deployments/promote", {
        deploymentId: "dep_1",
        projectId: 42,
      }),
    );

    expect(secrets.status).toBe(403);
    expect(promote.status).toBe(403);
  });

  it("does not let an invalid bearer bypass browser CSRF on CLI routes", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });

    const res = await launchDeployRoute(false)(
      new Request("http://localhost:3000/api/bff/deployments/deploy", {
        method: "POST",
        headers: {
          authorization: "Bearer invalid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: 42,
          sourceRef: "abc1234",
        }),
      }),
    );

    expect(res.status).toBe(403);
  });
});

describe("launchDeployRoute", () => {
  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("rejects deploy without a GitHub session before any backend call", async () => {
    getGitHubSession.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const res = await POST(
      new Request("http://localhost:3000/api/bff/launch/deploy", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: 123,
          sourceRef: "abc1234def5678",
        }),
      }),
    );

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects deploy of a project the user does not own", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ownedSources(1, 2));
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const res = await POST(
      new Request("http://localhost:3000/api/bff/launch/deploy", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: 123,
          sourceRef: "abc1234def5678",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("project not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/integrations/github-app/user/projects?github_user_id=42",
    );
  });

  it("propagates BackendError status codes (400-599)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(123))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "deploy rejected" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: 123,
        sourceRef: "abc1234def5678",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(409);
    expect(body).toEqual({ error: "deploy rejected" });
    expect(telemetry.capture).not.toHaveBeenCalled();
    expect(telemetry.log).not.toHaveBeenCalled();
  });

  it("logs and sanitizes a backend 5xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(123))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "private backend failure" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const res = await POST(
      new Request("http://localhost:3000/api/bff/launch/deploy", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: 123,
          sourceRef: "abc1234def5678",
        }),
      }),
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "private backend failure",
    });
    expect(telemetry.capture).not.toHaveBeenCalled();
    expect(telemetry.log).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "launch.deploy",
        upstream: "rust",
        upstreamStatus: 503,
      }),
    );
  });

  it("preflight resolves the existing Project by repo and immutable commit", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(123))
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

    const POST = launchDeployRoute(true);
    const req = new Request("http://localhost:3000/api/bff/launch/preflight", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ installationId: "555", repo: "alice/bot" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repo).toBe("alice/bot");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:8080/api/integrations/github-app/user/projects?github_user_id=42",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8080/api/projects/123/deploy",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ preflight: true }),
      }),
    );
  });

  it("real deploy rejects a repo-only request without a project id", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ installationId: "555", repo: "alice/bot" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deploys directly by projectId when the project identity is already known", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(777))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment: {
            id: "dep_999_rabc1234_deadbeef",
            source: {
              installation_id: 999,
              repository_link: "alice/bot",
              commit_hash: "abc1234def5678",
            },
            platform: { apps: [] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: 777,
        sourceRef: "abc1234def5678",
        installationId: "555",
        repo: "alice/bot",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toMatchObject({
      repo: "alice/bot",
      projectId: 777,
      projectUrl: "http://localhost:3000/projects/777?tab=deployments",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:8080/api/projects/777/deploy",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"source_ref":"abc1234def5678"'),
      }),
    );
  });

  it("deploys by Project identity without a client-selected platform", async () => {
    vi.stubEnv("APP_DEPLOY_PLATFORMS", "community,somm.finance");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedBoundProject(777, "somm.finance"))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          deployment: {
            id: "dep_999_rabc1234_deadbeef",
            source: {
              installation_id: 999,
              repository_link: "alice/bot",
              commit_hash: "abc1234def5678",
            },
            platform: { apps: [] },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const res = await POST(
      new Request("https://build-staging.aomi.dev/api/bff/deployments/deploy", {
        method: "POST",
        headers: {
          authorization: "Bearer cli-session",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          platform: "somm.finance",
          projectId: 777,
          sourceRef: "abc1234def5678",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.projectUrl).toBe(
      "https://build-staging.aomi.dev/projects/777?tab=deployments",
    );
    // Ownership is account-wide: the projects read carries no platform.
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("platform=");
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "http://127.0.0.1:8080/api/projects/777/deploy",
    );
    expect(fetchMock.mock.calls[1][1]?.body).toBe(
      JSON.stringify({
        source_ref: "abc1234def5678",
      }),
    );
  });

  it("rejects deploy requests when no source commit is supplied or resolved", async () => {
    vi.unstubAllEnvs();
    // The ownership lookup runs before commit resolution (authorize before
    // acting on the caller's behalf), so exactly one backend read happens.
    const fetchMock = vi.fn().mockResolvedValueOnce(ownedSources(777));
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ projectId: 777 }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("missing source commit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/integrations/github-app/user/projects",
    );
  });

  it("rejects a request without projectId or repo before calling the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ installationId: "555" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid repo before calling the backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ installationId: "555", repo: "not/a/repo" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 for non-BackendError exceptions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(123))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const POST = launchDeployRoute(false);
    const req = new Request("http://localhost:3000/api/bff/launch/deploy", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: 123,
        sourceRef: "abc1234def5678",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "deploy request failed",
    });
    expect(telemetry.capture).toHaveBeenCalledOnce();
    expect(telemetry.log).not.toHaveBeenCalled();
  });
});

describe("launchSdkStatusRoute", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prints the configured backend URL in the local SDK repair command", async () => {
    vi.stubEnv("BACKEND_URL", "");
    vi.stubEnv("NEXT_PUBLIC_BACKEND_URL", "https://api.example.test/");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ server_tags: ["staging"], sdk_version: "3.0.2" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await launchSdkStatusRoute(
      new Request("https://build.example.test/api/bff/launch/sdk-status"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sdkStatus.fixCommand).toBe(
      "aomi-build sdk fix --backend https://api.example.test",
    );
    expect(body.sdkStatus.fixCommand).not.toContain("build.example.test");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.example.test/api/platforms/server-tags",
    );
  });
});

describe("deploymentPromoteRoute", () => {
  const DEPLOYMENT = "dep_555_r0123abcdef_a5a81b6b8be1";

  function promoteReq(body: unknown) {
    return new Request("http://localhost:3000/api/bff/deployments/promote", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("rejects promote without a GitHub session before any backend call", async () => {
    getGitHubSession.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires projectId so the promote target can be authorized", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("projectId");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects promote of a Project the user does not own", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ownedSources(1, 2));
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("project not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a deployment absent from the exact Project candidate projection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(99))
      .mockResolvedValueOnce(
        Response.json({ deployment: null }, { status: 404 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain("get_user_project_deployment failed (404)");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Candidate authorization is an exact Project-scoped DB lookup.
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `/deployments/${DEPLOYMENT}`,
    );
  });

  it("promotes an owned deployment and attributes the GitHub login", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(99))
      .mockResolvedValueOnce(candidateDeployment(DEPLOYMENT))
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/community"))
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          activation: {
            status: "activating",
            apps: [{ name: "my-bot", release_tag: "apps-555-tag" }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.promote.deploymentId).toBe(DEPLOYMENT);
    // Promote goes through the one activation door with a deployment target.
    const [promoteUrl, promoteInit] = fetchMock.mock.calls[5];
    expect(String(promoteUrl)).toContain(`/deployments/${DEPLOYMENT}/promote`);
    const promoteBody = JSON.parse(String(promoteInit?.body));
    expect(promoteBody.mode).toBe("targeted");
    expect(promoteBody.apps).toEqual(["my-bot"]);
    expect(promoteBody.actor).toBe("alice");
  });

  it("409s a promote when a required secret is unfilled", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        activationSourceWithRepo("aomi-labs/my-bot-app", 99),
      )
      .mockResolvedValueOnce(candidateDeployment(DEPLOYMENT))
      // missingSecretsForActivation resolves platformRepo via the per-source
      // detail endpoint since latestDeployment is null on the list response.
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/my-bot-app"))
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

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "missing required secrets",
      missing: { "my-bot": ["MY_BOT_SECRET_KEY"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("promotes when required secrets are filled", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        activationSourceWithRepo("aomi-labs/my-bot-app", 99),
      )
      .mockResolvedValueOnce(candidateDeployment(DEPLOYMENT))
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(
        Response.json({
          by_app: {
            "my-bot": [
              "$SECRET:APP:my-bot::MY_BOT_API_KEY",
              "$SECRET:APP:my-bot::MY_BOT_SECRET_KEY",
            ],
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          activation: { status: "activating", apps: [] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("gates a pagination-external candidate from its exact projection (regression)", async () => {
    // Regression for the bypass where the secret gate derived its pairs from
    // A paginated history cannot prove candidate ownership. The exact
    // projection supplies the pair, so an old candidate still fails closed
    // on its unfilled required secret and promote is never called.
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        activationSourceWithRepo("aomi-labs/my-bot-app", 99),
      )
      .mockResolvedValueOnce(candidateDeployment(DEPLOYMENT))
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
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
              ],
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentPromoteRoute(
      promoteReq({ deploymentId: DEPLOYMENT, projectId: 99 }),
    );

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "missing required secrets",
      missing: { "my-bot": ["MY_BOT_API_KEY"] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("/promote")),
    ).toBe(false);
  });
});

describe("redeployLaunchRoute", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("reruns the latest deployment through the backend rerun endpoint", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(99))
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

    const res = await redeployLaunchRoute(writeReq({ projectId: 99 }));
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

  it("refuses redeploy when the source has no backend-owned deployment yet", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(99))
      .mockResolvedValueOnce(
        Response.json({
          latest_deployment: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await redeployLaunchRoute(writeReq({ projectId: 99 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("No backend-owned deployment");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a backend rerun rejection instead of masking it", async () => {
    getGitHubSession.mockResolvedValueOnce({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ownedSources(99))
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

    const res = await redeployLaunchRoute(writeReq({ projectId: 99 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain("no rerunnable GitHub Actions run");
  });
});

describe("deploymentDeactivateRoute", () => {
  function deactReq(body: unknown) {
    return new Request("http://localhost:3000/api/bff/deployments/deactivate", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("rejects without a session", async () => {
    getGitHubSession.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await deploymentDeactivateRoute(
      deactReq({ projectId: 99, apps: ["my-bot"] }),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires projectId and apps", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await deploymentDeactivateRoute(deactReq({ apps: ["x"] }))).status,
    ).toBe(400);
    expect(
      (await deploymentDeactivateRoute(deactReq({ projectId: 99 }))).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign Project", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        projects: [
          {
            id: 1,
            installation_id: 5,
            repository_link: "alice/other",
            platform_name: "community",
            apps: [],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await deploymentDeactivateRoute(
      deactReq({ projectId: 99, apps: ["my-bot"] }),
    );
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deactivates each owned app", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          projects: [
            {
              id: 99,
              installation_id: 5,
              repository_link: "alice/bot",
              platform_name: "community",
              apps: [
                { id: 701, name: "api" },
                { id: 702, name: "web" },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(Response.json(true))
      .mockResolvedValueOnce(Response.json(true));
    vi.stubGlobal("fetch", fetchMock);
    const res = await deploymentDeactivateRoute(
      deactReq({ projectId: 99, apps: ["api", "web"] }),
    );
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body).toMatchObject({ ok: true, apps: ["api", "web"] });
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/applications/701/deactivate",
    );
    expect(String(fetchMock.mock.calls[2][0])).toContain(
      "/applications/702/deactivate",
    );
  });
});

describe("activateLaunchRoute", () => {
  function activateReq(body: unknown) {
    return new Request("http://localhost:3000/api/bff/launch/activate", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("rejects without a session", async () => {
    getGitHubSession.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await activateLaunchRoute(
      activateReq({
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("409s when a required secret is unfilled", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationSourceWithRepo("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/my-bot-app"))
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

    const res = await activateLaunchRoute(
      activateReq({
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
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("tells the builder a missing GITHUB_TOKEN is not theirs to retry", async () => {
    // The gate still closes — verification genuinely cannot run — but this is
    // an operator problem, and the old pipeline flattened every check failure
    // to "Unable to verify required secrets. Try again.", which is the wrong
    // instruction for a credential the builder cannot supply.
    vi.stubEnv("GITHUB_TOKEN", "");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationSourceWithRepo("aomi-labs/my-bot-app"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await activateLaunchRoute(
      activateReq({
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );
    const body = (await res.json()) as {
      error: string;
      code?: string;
      retryable?: boolean;
    };

    expect(res.status).toBe(503);
    expect(body.retryable).toBe(false);
    expect(body.code).toBe("required_secrets_bff_misconfigured");
    expect(body.error).toMatch(/GitHub token/i);
    expect(body.error).not.toMatch(/try again/i);
  });

  it("activates when the release manifest declares no secrets for the app", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationSourceWithRepo("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/my-bot-app"))
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, activation: { apps: [] } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await activateLaunchRoute(
      activateReq({
        projectId: 99,
        apps: ["my-bot"],
        releaseTags: ["apps-555-r1-my-bot-abc"],
      }),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("requires projectId and app/tag pairs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (
        await activateLaunchRoute(
          activateReq({
            apps: ["my-bot"],
            releaseTags: ["apps-555-r1-my-bot-abc"],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await activateLaunchRoute(
          activateReq({
            projectId: 99,
            releaseTags: ["apps-555-r1-my-bot-abc"],
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await activateLaunchRoute(
          activateReq({
            projectId: 99,
            apps: ["my-bot", "web"],
            releaseTags: ["apps-555-r1-my-bot-abc"],
          }),
        )
      ).status,
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign Project or unmatched app/tag pair", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ownedSources(1)));
    expect(
      (
        await activateLaunchRoute(
          activateReq({
            projectId: 99,
            apps: ["my-bot"],
            releaseTags: ["apps-555-r1-my-bot-abc"],
          }),
        )
      ).status,
    ).toBe(404);

    // Unmatched pair: the route no longer pre-authorizes against a listing;
    // Manager's Project-scoped rejection is relayed as-is. Clear the read
    // cache so this part re-fetches ownership instead of riding part one's
    // cached (foreign-only) project list straight to a 404.
    vi.restoreAllMocks();
    clearLaunchReadCache();
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(activationSource())
        .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/community"))
        .mockResolvedValueOnce(Response.json({ by_app: {} }))
        .mockResolvedValueOnce(Response.json({ assets: [] }))
        .mockResolvedValueOnce(
          Response.json({ error: "release not found" }, { status: 404 }),
        ),
    );
    expect(
      (
        await activateLaunchRoute(
          activateReq({
            projectId: 99,
            apps: ["my-bot"],
            releaseTags: ["apps-555-r1-my-bot-wrong"],
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("activates only an owned app/tag pair", async () => {
    vi.stubEnv("GITHUB_TOKEN", "gh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(activationSource())
      .mockResolvedValueOnce(latestDeploymentResponse("aomi-labs/community"))
      .mockResolvedValueOnce(Response.json({ by_app: {} }))
      .mockResolvedValueOnce(Response.json({ assets: [] }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, activation: { apps: [] } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await activateLaunchRoute(
      activateReq({
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

describe("requiredSecretsRoute", () => {
  function requiredSecretsReq(query: string) {
    return new Request(
      `http://localhost:3000/api/bff/deployments/required-secrets${query}`,
    );
  }

  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "gh-1",
      githubLogin: "octocat",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("returns slots and the missing set per app", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/required-secrets?")) {
        return Response.json({
          by_app: {
            binance: {
              application_id: 77,
              slots: [
                { name: "BINANCE_API_KEY", description: "d", required: true },
                {
                  name: "BINANCE_SECRET_KEY",
                  description: "d2",
                  required: true,
                },
                {
                  name: "BINANCE_USER_KEY",
                  description: "Chat user trading key",
                  required: true,
                  user_own: true,
                },
              ],
            },
          },
        });
      }
      if (url.includes("/_internal/secrets?")) {
        return Response.json({
          by_app: { binance: ["$SECRET:APP:binance::BINANCE_API_KEY"] },
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await requiredSecretsRoute(requiredSecretsReq("?projectId=42"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      byApp: {
        binance: {
          applicationId: 77,
          slots: [
            { name: "BINANCE_API_KEY", description: "d", required: true },
            { name: "BINANCE_SECRET_KEY", description: "d2", required: true },
          ],
          missing: ["BINANCE_SECRET_KEY"],
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).startsWith("https://api.github.com"),
      ),
    ).toBe(false);
  });

  it("401s without a GitHub session", async () => {
    getGitHubSession.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await requiredSecretsRoute(requiredSecretsReq("?projectId=42"));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s for a source the user does not own", async () => {
    const fetchMock = vi.fn((input: unknown) =>
      String(input).includes("/required-secrets?")
        ? Response.json({ error: "source not found" }, { status: 404 })
        : Response.json({ by_app: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await requiredSecretsRoute(requiredSecretsReq("?projectId=99"));

    expect(res.status).toBe(404);
  });

  it("surfaces a Manager snapshot failure without falling back to GitHub", async () => {
    const fetchMock = vi.fn((input: unknown) =>
      String(input).includes("/required-secrets?")
        ? Response.json({ error: "projection missing" }, { status: 500 })
        : Response.json({ by_app: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await requiredSecretsRoute(requiredSecretsReq("?projectId=42"));

    expect(res.status).toBe(503);
    // A backend outage IS worth retrying, unlike the misconfiguration case
    // above — the contract now says which of the two this is.
    await expect(res.json()).resolves.toEqual({
      error: "Unable to verify required secrets. Try again.",
      code: "required_secrets_backend_unavailable",
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(telemetry.capture).not.toHaveBeenCalled();
    expect(telemetry.log).toHaveBeenCalledOnce();
  });
});

describe("launchAppsRoute", () => {
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
      .mockResolvedValueOnce(sourceWithApps(1578, [{ id: 77, name: "my-bot" }]))
      .mockResolvedValueOnce(
        Response.json({
          apps: [
            {
              id: 77,
              name: "my-bot",
              is_active: true,
              loaded: false,
              app_release_tag: "release-2",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const res = await launchAppsRoute(
      new Request("http://localhost:3000/api/bff/launch/apps?projectId=1578"),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      projectId: 1578,
      state: "pending",
      apps: [
        {
          id: 77,
          name: "my-bot",
          is_active: true,
          loaded: false,
          app_release_tag: "release-2",
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("deploymentRecordsRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("requires projectId ownership before listing records", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(ownedSources(1));
    vi.stubGlobal("fetch", fetchMock);
    const res = await deploymentRecordsRoute(
      new Request(
        "http://localhost:3000/api/bff/deployments/records?app=my-bot&projectId=99",
      ),
    );
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent ownership checks for the same source", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/user/projects?")) return ownedSources(99);
      if (url.includes("/apps/my-bot/records?")) return appRecords("dep_1");
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const req = () =>
      new Request(
        "http://localhost:3000/api/bff/deployments/records?app=my-bot&projectId=99",
      );

    const [first, second] = await Promise.all([
      deploymentRecordsRoute(req()),
      deploymentRecordsRoute(req()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/user/projects?"),
      ),
    ).toHaveLength(1);
  });
});

describe("deploymentSecretsRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("returns the canonical app with an empty key list when the vault is empty", async () => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          project: {
            id: 7,
            installation_id: 5,
            repository_id: 6,
            repository_link: "alice/demo",
            platform_id: 1,
            owner_builder_id: 2,
            created_at: 1,
            updated_at: 1,
          },
          platform: "community",
          application: { id: 11, name: "demo" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ by_app: {} }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentSecretsRoute(
      new Request(
        "http://localhost:3000/api/bff/deployments/secrets?applicationId=11",
      ),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ byApp: { demo: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("deploymentFeedRoute", () => {
  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("relays one account-scoped global feed request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      Response.json({
        deployments: [
          {
            deployment_id: "dep_1",
            project_id: 7,
            repository_link: "alice/app",
            created_at: 100,
            release_tags: [],
            apps: [],
          },
        ],
        next_cursor: { created_at: 100, id: 9 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentFeedRoute(
      new Request(
        "http://localhost:3000/api/bff/deployments/feed?platform=world-market-apps&limit=50&cursorCreatedAt=200&cursorId=10",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(
      "/api/integrations/github-app/user/deployments?",
    );
    expect(String(url)).toContain("github_user_id=42");
    expect(String(url)).toContain("platform=world-market-apps");
    expect(String(url)).toContain("cursor_created_at=200");
    expect(body).toMatchObject({
      deployments: [{ deploymentId: "dep_1", projectId: 7 }],
      nextCursor: { createdAt: 100, id: 9 },
    });
  });

  it("rejects partial cursors before calling manager", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await deploymentFeedRoute(
      new Request(
        "http://localhost:3000/api/bff/deployments/feed?limit=50&cursorId=10",
      ),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("launchStatusRoute", () => {
  beforeEach(() => {
    getGitHubSession.mockResolvedValue({
      githubUserId: "42",
      githubLogin: "alice",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getGitHubSession.mockReset();
  });

  it("propagates backend 404 instead of masking deployment status as pending", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "deployment not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await launchStatusRoute(
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

    const res = await launchStatusRoute(
      new Request(
        "http://localhost:3000/api/bff/launch/status?deploymentId=dep_141780080_r2849901c35_af4f107b0331",
      ),
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
