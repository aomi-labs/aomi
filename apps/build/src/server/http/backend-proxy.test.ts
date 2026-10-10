// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./backend-proxy";

const telemetry = vi.hoisted(() => ({ observe: vi.fn() }));

vi.mock("@/server/bff/failures", () => ({
  buildFailures: { handle: telemetry.observe },
}));

vi.mock("@/server/env", () => ({
  backendUrl: () => "https://api-staging.aomi.dev",
  deployConfig: () => ({ platform: "somm.finance" }),
}));

describe("Aomi Build API proxy", () => {
  beforeEach(() => {
    telemetry.observe.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("adds the primary launch platform to GitHub install redirects", async () => {
    const fetchMock = vi.fn(async (url: URL) =>
      Response.json({
        install_url: `https://github.com/apps/aomi/installations/new?${url.searchParams}`,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request(
        "https://build.aomi.dev/api/integrations/github-app/oauth/start?repo=aomi-labs/example",
      ),
      {
        params: Promise.resolve({
          slug: ["integrations", "github-app", "oauth", "start"],
        }),
      },
    );
    const body = await res.json();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://api-staging.aomi.dev/api/integrations/github-app/oauth/start?repo=aomi-labs%2Fexample&platform=somm.finance",
      }),
      expect.any(Object),
    );
    expect(body.install_url).toContain("platform=somm.finance");
  });

  it("rejects routes outside the launch allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request("https://build.aomi.dev/api/thread/apps"),
      {
        params: Promise.resolve({ slug: ["thread", "apps"] }),
      },
    );

    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(telemetry.observe).not.toHaveBeenCalled();
  });

  it("captures upstream request exceptions and returns a stable 502", async () => {
    const error = new Error("private network detail");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));

    const res = await GET(
      new Request(
        "https://build.aomi.dev/api/integrations/github-app/oauth/start",
      ),
      {
        params: Promise.resolve({
          slug: ["integrations", "github-app", "oauth", "start"],
        }),
      },
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Upstream request failed",
    });
    expect(telemetry.observe).toHaveBeenCalledOnce();
    expect(telemetry.observe).toHaveBeenCalledWith({
      source: "proxy",
      failure: {
        kind: "upstream_request",
        error,
        method: "GET",
        pathname: "/api/integrations/github-app/oauth/start",
        responseStatus: 502,
      },
    });
  });

  it("logs a downstream Rust 5xx without changing its response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "private backend body" }, { status: 503 }),
        ),
    );

    const res = await GET(
      new Request(
        "https://build.aomi.dev/api/integrations/github-app/oauth/start",
      ),
      {
        params: Promise.resolve({
          slug: ["integrations", "github-app", "oauth", "start"],
        }),
      },
    );

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: "private backend body",
    });
    expect(telemetry.observe).toHaveBeenCalledOnce();
    expect(telemetry.observe).toHaveBeenCalledWith({
      source: "proxy",
      failure: {
        kind: "upstream_response",
        status: 503,
        method: "GET",
        pathname: "/api/integrations/github-app/oauth/start",
        responseStatus: 503,
      },
    });
  });
});
