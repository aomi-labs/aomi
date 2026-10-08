import { NextResponse } from "next/server";

import { getGitHubSession } from "@/server/cookies/github";
import {
  finishCliAuthorization,
  parseCliLoginRequest,
  startGitHubOAuth,
} from "@/server/github-auth";

export const runtime = "nodejs";

// GET /api/bff/cli/login — authorize the CLI from the existing Build browser
// session. Signed-out browsers continue through the one shared GitHub flow.
export async function GET(req: Request) {
  const login = parseCliLoginRequest(new URL(req.url));
  if (!login) {
    return NextResponse.json(
      { error: "invalid CLI login request" },
      { status: 400 },
    );
  }

  const session = await getGitHubSession();
  return session
    ? finishCliAuthorization(session, login)
    : startGitHubOAuth(req, { kind: "cli", ...login });
}
