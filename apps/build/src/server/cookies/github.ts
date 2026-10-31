import "@tanstack/react-start/server-only";
import { getCookie } from "@tanstack/react-start/server";
import {
  bearerOf,
  GITHUB_SESSION_COOKIE,
  GitHubSessionSigner,
  SESSION_TTL_SECONDS,
  type GitHubCliScope,
  type GitHubSession,
} from "@aomi-labs/account/build-session";
import { appendCookie } from "@/server/http-response";
import { githubSessionSecret, secureCookies } from "@/server/env";

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

export async function setGitHubSessionCookie(
  response: Response,
  session: GitHubSession,
): Promise<void> {
  const token = await new GitHubSessionSigner(
    githubSessionSecret(),
  ).issueSession(session);
  appendCookie(response, GITHUB_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}
