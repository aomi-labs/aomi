import { NextResponse } from "next/server";

export const runtime = "nodejs";

import { setGitHubSessionCookie } from "@/server/cookies/github";
import { buildFailures } from "@/server/bff/failures";
import { devToolsAllowed } from "@/server/env";

type GitHubUserResponse = {
  id?: unknown;
  login?: unknown;
};

function isLocalhost(req: Request): boolean {
  const hostname = new URL(req.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function settingsUrl(req: Request): URL {
  const url = new URL(req.url);
  const settings = new URL("/settings", url.origin);
  settings.searchParams.set("launch", "github");
  return settings;
}

async function resolveGitHubUserId(login: string): Promise<string> {
  const response = await fetch(`https://api.github.com/users/${login}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "aomi-build-dev-session",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed (${response.status})`);
  }

  const body = (await response.json()) as GitHubUserResponse;
  if (typeof body.id !== "number" || !Number.isSafeInteger(body.id)) {
    throw new Error("GitHub user lookup did not return a numeric id");
  }
  return String(body.id);
}

// GET /api/bff/auth/github/dev-session?login=octocat[&id=...]
//
// Local development helper only. It mints the same signed httpOnly
// `aomi_github` cookie as the real OAuth callback so copied-link/account
// mismatch flows can be exercised when GitHub redirects are configured for a
// deployed frontend.
export async function GET(req: Request) {
  if (!devToolsAllowed() || !isLocalhost(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const login = url.searchParams.get("login")?.trim();
  if (!login) {
    return NextResponse.json({ error: "missing `login`" }, { status: 400 });
  }

  try {
    const explicitId = url.searchParams.get("id")?.trim();
    const githubUserId =
      explicitId && /^\d+$/.test(explicitId)
        ? explicitId
        : await resolveGitHubUserId(login);
    const res = NextResponse.redirect(settingsUrl(req));
    await setGitHubSessionCookie(res, {
      githubUserId,
      githubLogin: login,
    });
    return res;
  } catch (error) {
    return buildFailures.handle({
      source: "local",
      error,
      response: {
        status: 502,
        error: "github_user_lookup_failed",
      },
      context: {
        routeFamily: "/api/bff/auth/github/dev-session",
        operation: "github.dev_session",
        method: req.method,
      },
    }).response;
  }
}
