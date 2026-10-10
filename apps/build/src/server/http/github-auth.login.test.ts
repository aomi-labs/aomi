import { parse } from "cookie-es";
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { githubLoginRoute as GET } from "./github-auth";
import { readGitHubOAuthRequest } from "@/server/cookies/github";

describe("GitHub login route", () => {
  beforeEach(() => {
    vi.stubEnv("PORTAL_ONLY_SESSION_SECRET", "test-only-github-session-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the staging one-shot-app client id outside production", async () => {
    const res = await GET(
      new Request("http://localhost:3000/api/bff/auth/github/login"),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).toContain("https://github.com/login/oauth/authorize");
    expect(location).toContain("client_id=Iv23lilgvJz13pJekLSZ");
    expect(location).toContain(
      encodeURIComponent("http://localhost:3000/api/bff/auth/github/callback"),
    );
  });

  it("uses the production one-shot-app client id on the production host", async () => {
    const res = await GET(
      new Request("https://build.aomi.dev/api/bff/auth/github/login"),
    );
    expect(res.headers.get("location")).toContain(
      "client_id=Iv23li4wPpAfoGOJ6v0Q",
    );
  });

  it("preserves a validated template return through OAuth", async () => {
    const res = await GET(
      new Request(
        "https://build.aomi.dev/api/bff/auth/github/login?resume=template&platform=community",
      ),
    );
    const request = await readGitHubOAuthRequest(
      parse(res.headers.get("set-cookie") ?? "")["aomi_github_oauth_request"],
    );
    expect(request?.continuation).toEqual({
      kind: "template",
      platform: "community",
    });
  });

  it("rejects an invalid template platform", async () => {
    const res = await GET(
      new Request(
        "https://build.aomi.dev/api/bff/auth/github/login?resume=template&platform=https://evil.test",
      ),
    );
    expect(res.status).toBe(400);
  });
});
