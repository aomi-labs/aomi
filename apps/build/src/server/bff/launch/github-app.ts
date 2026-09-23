import "server-only";

import { NextResponse } from "next/server";
import { backendClient } from "@build/server/bff/backend";
import { authorize } from "@build/server/bff/auth";
import { buildFailures } from "@build/server/bff/failures";

/**
 * GitHub App access report for the signed-in builder: the Apps Build is
 * configured with, every installation reachable through their owned
 * projects, and — when `?platform=` is given — the platform repository's own
 * installation. A GET with no CSRF gate; the Manager answers with JWT-only
 * GitHub reads, so it is cheap enough for a settings page to re-check.
 */
export async function githubAppInstallationsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  // Ownership identity is the session's alone — never a query parameter.
  const platform =
    new URL(req.url).searchParams.get("platform")?.trim() || undefined;

  try {
    const client = await backendClient();
    const result = await client.listUserGitHubAppInstallations({
      githubUserId: session.githubUserId,
      platform,
    });
    // Permission state changes out of band (an org owner accepting a
    // request on GitHub); a cached answer here would keep saying "missing".
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return buildFailures.handle({
      source: "launch",
      error,
      context: {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.github_app_installations",
        method: req.method,
      },
    }).response;
  }
}
