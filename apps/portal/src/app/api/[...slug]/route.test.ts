// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const listApps = vi.fn();
const launchConfigMock = vi.hoisted(() => ({
  catalogPlatforms: [] as string[],
}));
const canonicalSessionMock = vi.hoisted(() => ({
  userId: null as string | null,
}));
const telemetry = vi.hoisted(() => ({
  capture: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@portal/server/bff/failures", async () => {
  const { classifyFailure, identifyFailure } =
    await import("@aomi-labs/bff-observability");
  return {
    portalFailures: {
      handle: (input: Parameters<typeof identifyFailure>[0]) => {
        const decision = classifyFailure(identifyFailure(input));
        const eventContext = {
          service: "portal-bff",
          ...decision.context,
          status: decision.responseStatus,
          ...(decision.upstream ? { upstream: decision.upstream } : {}),
          ...(decision.upstreamStatus !== undefined
            ? { upstreamStatus: decision.upstreamStatus }
            : {}),
          handled: decision.handled,
        };
        if (decision.action === "issue") {
          telemetry.capture(decision.error, eventContext);
        } else if (decision.action === "log") {
          telemetry.log(eventContext);
        }
        return {
          ...decision,
          response: Response.json(
            { error: decision.responseError },
            { status: decision.responseStatus },
          ),
        };
      },
    },
  };
});

vi.mock("@portal/server/canonical-session", () => ({
  resolveCanonicalUserId: vi.fn(async () => canonicalSessionMock.userId),
}));

// `createBackendProxy` imports the mint from the account package's internal
// module, so mock that dependency directly. Mocking only the package barrel
// leaves the proxy's lexical import real and makes this test depend on a local
// PORTAL_SERVICE_PRIVATE_KEY that CI intentionally does not provide.
vi.mock("../../../../../../packages/account/src/bearer", () => ({
  mintAccountBearer: vi.fn(async () => ({
    bearer: "test-bearer",
    expiresAt: 0,
  })),
}));

vi.mock("@portal/server/backend-url", () => ({
  configuredBackendUrl: () => "https://api-staging.aomi.dev",
}));

vi.mock("@portal/server/bff/backend", () => ({
  backendClient: vi.fn(async () => ({ listApps })),
}));

vi.mock("@portal/server/bff/launch/config", () => ({
  launchConfig: () => ({
    platform: "somm.finance",
    platforms: ["somm.finance", "community"],
    catalogPlatforms: launchConfigMock.catalogPlatforms,
  }),
}));

function apiRequest(path: string, method = "GET") {
  const url = new URL(`https://chat-staging.aomi.dev${path}`);
  const slug = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
  return [
    new NextRequest(url, { method }),
    { params: Promise.resolve({ slug }) },
  ] as const;
}

function proxiedUrl(call: unknown[] | undefined): URL {
  const input = call?.[0];
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  throw new Error(`Unexpected proxied URL: ${String(input)}`);
}

describe("portal API proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    launchConfigMock.catalogPlatforms = [];
    canonicalSessionMock.userId = null;
    listApps.mockReset();
    telemetry.capture.mockReset();
    telemetry.log.mockReset();
  });

  it("forwards the backend thread app catalog without a default platform filter", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([
        { name: "default" },
        { name: "somm-agent", application_id: 1, platform: "somm.finance" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(...apiRequest("/api/thread/apps"));
    const body = await res.json();

    expect(body).toEqual([
      { name: "default" },
      { name: "somm-agent", application_id: 1, platform: "somm.finance" },
    ]);
    const url = proxiedUrl(fetchMock.mock.calls[0]);
    expect(url.pathname).toBe("/api/thread/apps");
    expect(url.search).toBe("");
    expect(listApps).not.toHaveBeenCalled();
  });

  it("adds explicit catalog platform filters to thread app catalog calls", async () => {
    launchConfigMock.catalogPlatforms = ["somm.finance", "community"];
    const fetchMock = vi.fn(async () => Response.json([{ name: "default" }]));
    vi.stubGlobal("fetch", fetchMock);

    await GET(...apiRequest("/api/thread/apps"));

    const url = proxiedUrl(fetchMock.mock.calls[0]);
    expect(url.pathname).toBe("/api/thread/apps");
    expect(url.search).toBe("?platform=somm.finance&platform=community");
    expect(listApps).not.toHaveBeenCalled();
  });

  it("preserves an explicit thread app platform filter", async () => {
    const fetchMock = vi.fn(async () => Response.json([{ name: "default" }]));
    vi.stubGlobal("fetch", fetchMock);

    await GET(...apiRequest("/api/thread/apps?platform=community"));

    const url = proxiedUrl(fetchMock.mock.calls[0]);
    expect(url.pathname).toBe("/api/thread/apps");
    expect(url.search).toBe("?platform=community");
    expect(listApps).not.toHaveBeenCalled();
  });

  it("forwards GitHub App OAuth start anonymously with its app query", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        install_url: "https://github.com/apps/aomi/installations/new",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      ...apiRequest("/api/integrations/github-app/oauth/start?app=2"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      install_url: "https://github.com/apps/aomi/installations/new",
    });
    const url = proxiedUrl(fetchMock.mock.calls[0]);
    expect(url.pathname).toBe("/api/integrations/github-app/oauth/start");
    expect(url.search).toBe("?app=2");
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("rejects stale settings account proxy calls", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(...apiRequest("/api/settings/account"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "Unsupported API route" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards opaque generic signing completions and rejects deleted AA-specific routes", async () => {
    canonicalSessionMock.userId = "widget-user-1";
    const fetchMock = vi.fn(async () => Response.json({ state: "signed" }));
    vi.stubGlobal("fetch", fetchMock);
    const requestId = "sign%3A11111111-2222-4333-8444-555555555555";

    const response = await POST(
      ...apiRequest(`/api/widget/v1/signing-requests/${requestId}`, "POST"),
    );

    expect(response.status).toBe(200);
    expect(proxiedUrl(fetchMock.mock.calls[0]).pathname).toBe(
      `/api/widget/v1/signing-requests/${requestId}`,
    );

    fetchMock.mockClear();
    const stale = await POST(
      ...apiRequest(
        "/api/widget/v1/aa-operations/operation-7/signatures",
        "POST",
      ),
    );
    expect(stale.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the commit lifecycle operations through the authenticated proxy", async () => {
    canonicalSessionMock.userId = "widget-user-1";
    const fetchMock = vi.fn(async () => Response.json({ state: "submitted" }));
    vi.stubGlobal("fetch", fetchMock);
    const id = "11111111-2222-4333-8444-555555555555";
    const attemptId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    for (const [path, method] of [
      ["/api/commits", "POST"],
      [`/api/commits/${id}`, "GET"],
      [`/api/commits/${id}/manual`, "POST"],
      [`/api/commits/${id}/wallet-attempts`, "POST"],
      [`/api/commits/${id}/wallet-attempts/${attemptId}/report`, "POST"],
    ] as const) {
      const response = await (method === "GET" ? GET : POST)(
        ...apiRequest(path, method),
      );
      expect(response.status).toBe(200);
      expect(proxiedUrl(fetchMock.mock.calls.at(-1)!).pathname).toBe(path);
    }

    fetchMock.mockClear();
    canonicalSessionMock.userId = null;
    const unauthenticated = await POST(
      ...apiRequest(`/api/commits/${id}/wallet-attempts`, "POST"),
    );
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      error: "Authentication required",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    canonicalSessionMock.userId = "widget-user-1";
    fetchMock.mockClear();
    expect(
      (await POST(...apiRequest(`/api/commits/${id}/broadcast`, "POST")))
        .status,
    ).toBe(404);
    expect(
      (await GET(...apiRequest(`/api/commits/${id}/wallet-attempts`))).status,
    ).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs a downstream Rust 5xx without changing its response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "private backend detail" }, { status: 503 }),
      ),
    );

    const res = await GET(...apiRequest("/api/thread/apps"));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "private backend detail",
    });
    expect(telemetry.capture).not.toHaveBeenCalled();
    expect(telemetry.log).toHaveBeenCalledWith({
      service: "portal-bff",
      routeFamily: "/api/thread/apps",
      operation: "proxy.upstream_response",
      method: "GET",
      status: 503,
      upstream: "rust",
      upstreamStatus: 503,
      handled: true,
    });
  });

  it("captures the original proxy network error exactly once", async () => {
    const failure = new Error("private socket detail");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(failure)),
    );

    const res = await GET(...apiRequest("/api/thread/apps"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Upstream request failed",
    });
    expect(telemetry.log).not.toHaveBeenCalled();
    expect(telemetry.capture).toHaveBeenCalledTimes(1);
    expect(telemetry.capture).toHaveBeenCalledWith(failure, {
      service: "portal-bff",
      routeFamily: "/api/thread/apps",
      operation: "proxy.upstream_request",
      method: "GET",
      status: 502,
      upstream: "rust",
      handled: true,
    });
  });
});
