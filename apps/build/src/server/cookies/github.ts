import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { githubSessionSecret, secureCookies } from "@/server/env";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

/**
 * Aomi Build's GitHub session, as the Vercel routes the edge does not serve
 * yet (build runs, integrations, dev session) read it. The edge issues these
 * cookies and CLI bearers (apps/edge/src/build/session.ts); the OAuth request
 * and PKCE exchange live only there.
 */
const GITHUB_SESSION_COOKIE = "aomi_github";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// A CLI token cannot be revoked yet, so it lives one day, not a browser week.
const CLI_SESSION_TTL_SECONDS = 24 * 60 * 60;
const CLI_SESSION_AUDIENCE = "aomi-build-cli";
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "lax" as const,
  path: "/",
};

export const CLI_SCOPES = ["deploy", "deployment:read", "activate"] as const;
export type GitHubCliScope = (typeof CLI_SCOPES)[number];

export interface GitHubSession {
  githubUserId: string;
  githubLogin: string;
  installationId?: string | null;
}

function secret(): Uint8Array {
  const value = githubSessionSecret();
  if (!value || value.length < 16) {
    throw new Error(
      "PORTAL_ONLY_SESSION_SECRET is not set (or too short) — the GitHub session cookie needs a signing secret",
    );
  }
  return new TextEncoder().encode(value);
}

async function sign(
  payload: JWTPayload,
  ttl: number,
  options: { subject?: string; audience?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let token = new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ttl);
  if (options.subject) token = token.setSubject(options.subject);
  if (options.audience) token = token.setAudience(options.audience);
  return token.sign(secret());
}

async function verify(
  token: string | undefined,
  audience?: string,
): Promise<JWTPayload | null> {
  if (!token) return null;
  try {
    return (await jwtVerify(token, secret(), { audience })).payload;
  } catch {
    return null;
  }
}

function githubSessionClaims(session: GitHubSession) {
  return {
    login: session.githubLogin,
    installationId: session.installationId ?? null,
  };
}

function sessionFromPayload(payload: {
  sub?: string;
  login?: unknown;
  installationId?: unknown;
}): GitHubSession | null {
  const githubUserId = typeof payload.sub === "string" ? payload.sub : "";
  if (!githubUserId) return null;
  return {
    githubUserId,
    githubLogin: typeof payload.login === "string" ? payload.login : "",
    installationId:
      typeof payload.installationId === "string"
        ? payload.installationId
        : null,
  };
}

export async function issueGitHubSession(
  session: GitHubSession,
): Promise<string> {
  return sign(githubSessionClaims(session), SESSION_TTL_SECONDS, {
    subject: session.githubUserId,
  });
}

export async function readGitHubSession(
  token: string | undefined,
): Promise<GitHubSession | null> {
  const payload = await verify(token);
  return payload ? sessionFromPayload(payload) : null;
}

export async function issueGitHubCliSession(
  session: GitHubSession,
): Promise<string> {
  return sign(
    {
      ...githubSessionClaims(session),
      kind: "cli_session",
      scopes: CLI_SCOPES,
    },
    CLI_SESSION_TTL_SECONDS,
    { subject: session.githubUserId, audience: CLI_SESSION_AUDIENCE },
  );
}

export async function readGitHubCliSession(
  token: string | undefined,
  requiredScope?: GitHubCliScope,
): Promise<GitHubSession | null> {
  const payload = await verify(token, CLI_SESSION_AUDIENCE);
  const scopes = Array.isArray(payload?.scopes) ? payload.scopes : [];
  if (
    !payload ||
    payload.kind !== "cli_session" ||
    (requiredScope && !scopes.includes(requiredScope))
  ) {
    return null;
  }
  return sessionFromPayload(payload);
}

export async function getGitHubSession(): Promise<GitHubSession | null> {
  const jar = await cookies();
  return readGitHubSession(jar.get(GITHUB_SESSION_COOKIE)?.value);
}

export async function getGitHubCliSessionFromRequest(
  request: Request,
  scope?: GitHubCliScope,
): Promise<GitHubSession | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  return readGitHubCliSession(token, scope);
}

export async function setGitHubSessionCookie(
  response: NextResponse,
  session: GitHubSession,
): Promise<void> {
  const token = await issueGitHubSession(session);
  response.cookies.set(GITHUB_SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_TTL_SECONDS,
  });
}
