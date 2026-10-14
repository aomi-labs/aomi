import { NextResponse } from "next/server";

import { startGitHubOAuth } from "@/server/github-auth";
import { authorize } from "@/server/bff/auth";

export const runtime = "nodejs";

// The project viewer is intentionally the entry point for Claim. GitHub OAuth
// only starts after this explicit click; loading an org project never prompts.
export async function GET(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: "invalid projectId" }, { status: 400 });
  }
  return startGitHubOAuth(req, { kind: "claim", projectId });
}
