import { startGitHubOAuth } from "@/server/github-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/bff/auth/github/login — the single entrypoint for GitHub OAuth.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  if (params.get("resume") === "template") {
    const platform = params.get("platform");
    if (!platform || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/.test(platform)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }
    return startGitHubOAuth(req, { kind: "template", platform });
  }
  return startGitHubOAuth(req, { kind: "browser" });
}
