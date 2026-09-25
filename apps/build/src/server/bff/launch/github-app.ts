import "server-only";

import { NextResponse } from "next/server";
import { backendClient } from "@build/server/bff/backend";
import { authorize } from "@build/server/bff/auth";
import { buildFailures } from "@build/server/bff/failures";

/** Builder-owned source repository access. A GET has no CSRF gate. */
export async function githubAppInstallationsRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const { session } = auth;
  // Ownership identity is the session's alone — never a query parameter.
  try {
    const client = await backendClient();
    const result = await client.listUserGitHubAppInstallations({
      githubUserId: session.githubUserId,
    });
    // Permission state changes out of band (an org owner accepting a
    // request on GitHub); a cached answer here would keep saying "missing".
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure = buildFailures.handle({
      source: "launch",
      error,
      context: {
        routeFamily: new URL(req.url).pathname,
        operation: "deployment.github_app_installations",
        method: req.method,
      },
    }).response;
    return NextResponse.json(
      { error: "Couldn’t check GitHub repository access. Try again." },
      { status: failure.status },
    );
  }
}
