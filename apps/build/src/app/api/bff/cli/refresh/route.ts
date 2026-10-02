import { NextResponse } from "next/server";
import {
  CLI_SESSION_TTL_SECONDS,
  getGitHubCliSessionFromRequest,
  renewGitHubCliSession,
} from "@build/server/cookies/github";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getGitHubCliSessionFromRequest(req);
  const accessToken = session ? await renewGitHubCliSession(req) : null;
  if (!accessToken || !session)
    return NextResponse.json(
      { error: "CLI login expired or invalid" },
      { status: 401 },
    );
  return NextResponse.json(
    {
      accessToken,
      tokenType: "Bearer",
      expiresIn: CLI_SESSION_TTL_SECONDS,
      githubLogin: session.githubLogin,
      githubUserId: session.githubUserId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
