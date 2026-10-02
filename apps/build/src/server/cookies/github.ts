import "server-only";

import { createHash } from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  CompactEncrypt,
  SignJWT,
  compactDecrypt,
  jwtVerify,
  type JWTPayload,
} from "jose";

/**
 * Aomi Build's standalone GitHub session. The backend resolves the verified
 * GitHub identity; Build stores it in this HTTP-only cookie and scopes every
 * browser control-plane request from it.
 */
export const GITHUB_SESSION_COOKIE = "aomi_github";
/** Opaque Manager-signed grant, intentionally separate from the session. */
export const GITHUB_VISIBILITY_GRANT_COOKIE = "aomi_github_visibility";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const CLI_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const CLI_SESSION_AUDIENCE = "aomi-build-cli";
const CLI_EXCHANGE_TYPE = "aomi-build-cli-exchange";
const OAUTH_REQUEST_AUDIENCE = "aomi-build-github-oauth-request";
const CLI_EXCHANGE_TTL_SECONDS = 2 * 60;
const OAUTH_REQUEST_TTL_SECONDS = 10 * 60;
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
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

export interface GitHubCliLoginRequest {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}

export type GitHubOAuthContinuation =
  | { kind: "browser" }
  | { kind: "template"; platform: string }
  | { kind: "claim"; projectId: number }
  | ({ kind: "cli" } & GitHubCliLoginRequest);

export interface GitHubOAuthRequest {
  oauthState: string;
  continuation: GitHubOAuthContinuation;
}

export interface GitHubCliExchange {
  accessToken: string;
  session: GitHubSession;
  codeChallenge: string;
}

function secret(): Uint8Array {
  const value = process.env.PORTAL_ONLY_SESSION_SECRET?.trim();
  if (!value || value.length < 16) {
    throw new Error(
      "PORTAL_ONLY_SESSION_SECRET is not set (or too short) — the GitHub session cookie needs a signing secret",
    );
  }
  return new TextEncoder().encode(value);
}

function exchangeKey(): Uint8Array {
  return createHash("sha256").update(secret()).digest();
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

function cliContinuation(value: unknown): GitHubOAuthContinuation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "browser") return { kind: "browser" };
  if (
    candidate.kind === "template" &&
    typeof candidate.platform === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/.test(candidate.platform)
  ) {
    return { kind: "template", platform: candidate.platform };
  }
  if (
    candidate.kind === "claim" &&
    typeof candidate.projectId === "number" &&
    Number.isSafeInteger(candidate.projectId) &&
    candidate.projectId > 0
  ) {
    return { kind: "claim", projectId: candidate.projectId };
  }
  if (
    candidate.kind !== "cli" ||
    typeof candidate.redirectUri !== "string" ||
    typeof candidate.state !== "string" ||
    typeof candidate.codeChallenge !== "string"
  ) {
    return null;
  }
  return {
    kind: "cli",
    redirectUri: candidate.redirectUri,
    state: candidate.state,
    codeChallenge: candidate.codeChallenge,
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

export function setGitHubVisibilityGrantCookie(
  response: NextResponse,
  grant: string | null | undefined,
): void {
  response.cookies.set(GITHUB_VISIBILITY_GRANT_COOKIE, grant?.trim() ?? "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: grant?.trim() ? 10 * 60 : 0,
  });
}

export async function getGitHubVisibilityGrant(): Promise<string | null> {
  return (
    (await cookies()).get(GITHUB_VISIBILITY_GRANT_COOKIE)?.value?.trim() || null
  );
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

/** Renew a verified CLI bearer, retaining its exact scopes and audience. */
export async function renewGitHubCliSession(
  req: Request,
): Promise<string | null> {
  const token = req.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const payload = await verify(token, CLI_SESSION_AUDIENCE);
  if (!payload || payload.kind !== "cli_session") return null;
  const session = sessionFromPayload(payload);
  if (
    !session ||
    !Array.isArray(payload.scopes) ||
    !payload.scopes.every((scope) =>
      CLI_SCOPES.includes(scope as GitHubCliScope),
    )
  )
    return null;
  return sign(
    {
      ...githubSessionClaims(session),
      kind: "cli_session",
      scopes: payload.scopes,
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

export async function issueGitHubOAuthRequest(
  request: GitHubOAuthRequest,
): Promise<string> {
  return sign(
    {
      kind: "github_oauth_request",
      oauthState: request.oauthState,
      continuation: request.continuation,
    },
    OAUTH_REQUEST_TTL_SECONDS,
    { audience: OAUTH_REQUEST_AUDIENCE },
  );
}

export async function readGitHubOAuthRequest(
  token: string | undefined,
): Promise<GitHubOAuthRequest | null> {
  const payload = await verify(token, OAUTH_REQUEST_AUDIENCE);
  const continuation = cliContinuation(payload?.continuation);
  if (
    !payload ||
    payload.kind !== "github_oauth_request" ||
    typeof payload.oauthState !== "string" ||
    !continuation
  ) {
    return null;
  }
  return { oauthState: payload.oauthState, continuation };
}

/**
 * Encrypt the final CLI session inside the short-lived PKCE exchange code.
 * Repeating an exchange returns the same session token rather than minting
 * additional credentials; the token is opaque until the server decrypts it.
 */
export async function issueGitHubCliExchange(
  session: GitHubSession,
  codeChallenge: string,
): Promise<string> {
  const accessToken = await issueGitHubCliSession(session);
  const payload = new TextEncoder().encode(
    JSON.stringify({
      accessToken,
      codeChallenge,
      expiresAt: Math.floor(Date.now() / 1000) + CLI_EXCHANGE_TTL_SECONDS,
    }),
  );
  return new CompactEncrypt(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: CLI_EXCHANGE_TYPE })
    .encrypt(exchangeKey());
}

export async function readGitHubCliExchange(
  code: string | undefined,
): Promise<GitHubCliExchange | null> {
  if (!code) return null;
  try {
    const { plaintext, protectedHeader } = await compactDecrypt(
      code,
      exchangeKey(),
    );
    if (protectedHeader.typ !== CLI_EXCHANGE_TYPE) return null;
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as Record<
      string,
      unknown
    >;
    if (
      typeof decoded.accessToken !== "string" ||
      typeof decoded.codeChallenge !== "string" ||
      typeof decoded.expiresAt !== "number" ||
      decoded.expiresAt < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    const session = await readGitHubCliSession(decoded.accessToken);
    return session
      ? {
          accessToken: decoded.accessToken,
          session,
          codeChallenge: decoded.codeChallenge,
        }
      : null;
  } catch {
    return null;
  }
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

export function clearGitHubSessionCookie(response: NextResponse): void {
  response.cookies.set(GITHUB_SESSION_COOKIE, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
