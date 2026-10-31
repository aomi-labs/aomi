/**
 * Aomi Build's standalone GitHub session, ported from the Build server's
 * `server/cookies/github.ts` with the same cookie names, audiences, lifetimes
 * and claims so cookies issued by either side verify on the other during the
 * cutover. The backend resolves the verified GitHub identity; this module only
 * signs and reads what Build stores about it.
 */
import { CompactEncrypt, SignJWT, compactDecrypt, jwtVerify, type JWTPayload } from "jose";

export const GITHUB_SESSION_COOKIE = "aomi_github";
/** Opaque Manager-signed grant, intentionally separate from the session. */
export const GITHUB_VISIBILITY_GRANT_COOKIE = "aomi_github_visibility";
export const GITHUB_OAUTH_REQUEST_COOKIE = "aomi_github_oauth_request";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// A CLI token cannot be revoked yet, so it lives one day, not a browser week.
export const CLI_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const VISIBILITY_GRANT_TTL_SECONDS = 10 * 60;
export const OAUTH_REQUEST_TTL_SECONDS = 10 * 60;
const CLI_EXCHANGE_TTL_SECONDS = 2 * 60;
const CLI_SESSION_AUDIENCE = "aomi-build-cli";
const CLI_EXCHANGE_TYPE = "aomi-build-cli-exchange";
const OAUTH_REQUEST_AUDIENCE = "aomi-build-github-oauth-request";

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

export const PLATFORM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/;

/** The HS256 secret and a clock: the only state the session module needs. */
export class GitHubSessionSigner {
  private readonly secret: Uint8Array<ArrayBuffer>;
  private exchangeKey: Promise<Uint8Array> | null = null;

  constructor(
    secret: string | undefined,
    private readonly now: () => number = Date.now,
  ) {
    const value = secret?.trim() ?? "";
    if (value.length < 16) {
      throw new Error(
        "BUILD_SESSION_SECRET is not set (or too short) — the GitHub session cookie needs a signing secret",
      );
    }
    this.secret = new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
  }

  private seconds(): number {
    return Math.floor(this.now() / 1000);
  }

  private async sign(
    payload: JWTPayload,
    ttl: number,
    options: { subject?: string; audience?: string } = {},
  ): Promise<string> {
    const now = this.seconds();
    let token = new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(now)
      .setExpirationTime(now + ttl);
    if (options.subject) token = token.setSubject(options.subject);
    if (options.audience) token = token.setAudience(options.audience);
    return token.sign(this.secret);
  }

  private async verify(token: string | undefined, audience?: string): Promise<JWTPayload | null> {
    if (!token) return null;
    try {
      return (
        await jwtVerify(token, this.secret, {
          audience,
          currentDate: new Date(this.now()),
        })
      ).payload;
    } catch {
      return null;
    }
  }

  private key(): Promise<Uint8Array> {
    this.exchangeKey ??= crypto.subtle
      .digest("SHA-256", this.secret as BufferSource)
      .then((digest) => new Uint8Array(digest));
    return this.exchangeKey;
  }

  issueSession(session: GitHubSession): Promise<string> {
    return this.sign(sessionClaims(session), SESSION_TTL_SECONDS, { subject: session.githubUserId });
  }

  async readSession(token: string | undefined): Promise<GitHubSession | null> {
    const payload = await this.verify(token);
    return payload ? sessionFromPayload(payload) : null;
  }

  issueCliSession(session: GitHubSession): Promise<string> {
    return this.sign(
      { ...sessionClaims(session), kind: "cli_session", scopes: CLI_SCOPES },
      CLI_SESSION_TTL_SECONDS,
      { subject: session.githubUserId, audience: CLI_SESSION_AUDIENCE },
    );
  }

  async readCliSession(
    token: string | undefined,
    requiredScope?: GitHubCliScope,
  ): Promise<GitHubSession | null> {
    const payload = await this.verify(token, CLI_SESSION_AUDIENCE);
    const scopes = Array.isArray(payload?.scopes) ? payload.scopes : [];
    if (!payload || payload.kind !== "cli_session" || (requiredScope && !scopes.includes(requiredScope)))
      return null;
    return sessionFromPayload(payload);
  }

  issueOAuthRequest(request: GitHubOAuthRequest): Promise<string> {
    return this.sign(
      { kind: "github_oauth_request", oauthState: request.oauthState, continuation: request.continuation },
      OAUTH_REQUEST_TTL_SECONDS,
      { audience: OAUTH_REQUEST_AUDIENCE },
    );
  }

  async readOAuthRequest(token: string | undefined): Promise<GitHubOAuthRequest | null> {
    const payload = await this.verify(token, OAUTH_REQUEST_AUDIENCE);
    const continuation = continuationFrom(payload?.continuation);
    if (
      !payload ||
      payload.kind !== "github_oauth_request" ||
      typeof payload.oauthState !== "string" ||
      !continuation
    )
      return null;
    return { oauthState: payload.oauthState, continuation };
  }

  /**
   * Encrypt the final CLI session inside the short-lived PKCE exchange code.
   * Repeating an exchange returns the same session token rather than minting
   * additional credentials; the token is opaque until the edge decrypts it.
   */
  async issueCliExchange(session: GitHubSession, codeChallenge: string): Promise<string> {
    const accessToken = await this.issueCliSession(session);
    const payload = new TextEncoder().encode(
      JSON.stringify({ accessToken, codeChallenge, expiresAt: this.seconds() + CLI_EXCHANGE_TTL_SECONDS }),
    );
    return new CompactEncrypt(payload)
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: CLI_EXCHANGE_TYPE })
      .encrypt(await this.key());
  }

  async readCliExchange(code: string | undefined): Promise<GitHubCliExchange | null> {
    if (!code) return null;
    try {
      const { plaintext, protectedHeader } = await compactDecrypt(code, await this.key());
      if (protectedHeader.typ !== CLI_EXCHANGE_TYPE) return null;
      const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
      if (
        typeof decoded.accessToken !== "string" ||
        typeof decoded.codeChallenge !== "string" ||
        typeof decoded.expiresAt !== "number" ||
        decoded.expiresAt < this.seconds()
      )
        return null;
      const session = await this.readCliSession(decoded.accessToken);
      return session ? { accessToken: decoded.accessToken, session, codeChallenge: decoded.codeChallenge } : null;
    } catch {
      return null;
    }
  }
}

function sessionClaims(session: GitHubSession) {
  return { login: session.githubLogin, installationId: session.installationId ?? null };
}

function sessionFromPayload(payload: JWTPayload): GitHubSession | null {
  const githubUserId = typeof payload.sub === "string" ? payload.sub : "";
  if (!githubUserId) return null;
  return {
    githubUserId,
    githubLogin: typeof payload.login === "string" ? payload.login : "",
    installationId: typeof payload.installationId === "string" ? payload.installationId : null,
  };
}

function continuationFrom(value: unknown): GitHubOAuthContinuation | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "browser") return { kind: "browser" };
  if (candidate.kind === "template" && typeof candidate.platform === "string" && PLATFORM_PATTERN.test(candidate.platform))
    return { kind: "template", platform: candidate.platform };
  if (
    candidate.kind === "claim" &&
    typeof candidate.projectId === "number" &&
    Number.isSafeInteger(candidate.projectId) &&
    candidate.projectId > 0
  )
    return { kind: "claim", projectId: candidate.projectId };
  if (
    candidate.kind !== "cli" ||
    typeof candidate.redirectUri !== "string" ||
    typeof candidate.state !== "string" ||
    typeof candidate.codeChallenge !== "string"
  )
    return null;
  return {
    kind: "cli",
    redirectUri: candidate.redirectUri,
    state: candidate.state,
    codeChallenge: candidate.codeChallenge,
  };
}

/** The bearer a CLI presents, or nothing. */
export function bearerOf(request: Request): string {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}
