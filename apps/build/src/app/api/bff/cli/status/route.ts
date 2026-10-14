import { NextResponse } from "next/server";

import { getGitHubCliSessionFromRequest } from "@/server/cookies/github";

export const runtime = "nodejs";

// GET /api/bff/cli/status — validate a saved CLI bearer without exposing it.
export async function GET(req: Request) {
  const session = await getGitHubCliSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ signedIn: false }, { status: 401 });
  }
  return NextResponse.json({
    signedIn: true,
    githubLogin: session.githubLogin,
    githubUserId: session.githubUserId,
  });
}
