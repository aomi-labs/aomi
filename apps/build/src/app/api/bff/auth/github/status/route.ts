import { NextResponse } from "next/server";

export const runtime = "nodejs";

import { getGitHubSession } from "@/server/cookies/github";

// GET /api/bff/auth/github/status — what the client needs to gate the UI: whether
// a GitHub session exists and its login. The github_user_id stays server-side.
export async function GET() {
  const session = await getGitHubSession();
  return NextResponse.json({
    signedIn: Boolean(session),
    githubLogin: session?.githubLogin ?? null,
    githubAvatarUrl: session
      ? `https://avatars.githubusercontent.com/u/${encodeURIComponent(session.githubUserId)}?s=96&v=4`
      : null,
    // Present when the one-shot App is already installed → the wizard skips the
    // install step. The github_user_id stays server-side.
    installationId: session?.installationId ?? null,
  });
}
