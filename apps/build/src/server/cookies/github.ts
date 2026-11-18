import "@tanstack/react-start/server-only";
import { getCookie } from "@tanstack/react-start/server";
import {
  bearerOf,
  GITHUB_SESSION_COOKIE,
  GitHubSessionSigner,
  type GitHubCliScope,
  type GitHubSession,
} from "@aomi-labs/account/build-session";
import { githubSessionSecret } from "@/server/env";

export type {
  GitHubCliScope,
  GitHubSession,
} from "@aomi-labs/account/build-session";

export async function getGitHubSession(): Promise<GitHubSession | null> {
  const token = getCookie(GITHUB_SESSION_COOKIE);
  if (!token) return null;
  try {
    return await new GitHubSessionSigner(githubSessionSecret()).readSession(
      token,
    );
  } catch {
    return null;
  }
}

export async function getGitHubCliSessionFromRequest(
  request: Request,
  scope?: GitHubCliScope,
): Promise<GitHubSession | null> {
  const token = bearerOf(request);
  if (!token) return null;
  try {
    return await new GitHubSessionSigner(githubSessionSecret()).readCliSession(
      token,
      scope,
    );
  } catch {
    return null;
  }
}
