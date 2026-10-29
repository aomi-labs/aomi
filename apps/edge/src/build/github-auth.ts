/**
 * Build's GitHub sign-in and CLI login, ported from the Build BFF
 * (`server/github-auth.ts` and the `/api/bff/auth/github/*`, `/api/bff/cli/*`
 * routes). Browser login ends in Build; CLI login resumes a signed loopback
 * continuation after minting the same browser session.
 */
import { BackendError } from "@aomi-labs/deploy";

import { randomHex } from "../kernel/crypto";
import type { BuildContext } from "./context";
import { appendCookie, readCookie, serializeCookie } from "./cookies";
import { managerClient } from "./manager-client";
import {
  CLI_SESSION_TTL_SECONDS,
  GITHUB_OAUTH_REQUEST_COOKIE,
  GITHUB_SESSION_COOKIE,
  GITHUB_VISIBILITY_GRANT_COOKIE,
  GitHubSessionSigner,
  OAUTH_REQUEST_TTL_SECONDS,
  PLATFORM_PATTERN,
  SESSION_TTL_SECONDS,
  VISIBILITY_GRANT_TTL_SECONDS,
  bearerOf,
  type GitHubCliLoginRequest,
  type GitHubOAuthContinuation,
  type GitHubSession,
} from "./session";

const GITHUB_LOGIN_APP_INDEX = 2;

export const GITHUB_CALLBACK_PATH = "/api/bff/auth/github/callback";

export function signerFor(ctx: BuildContext): GitHubSessionSigner {
  return new GitHubSessionSigner(ctx.env.BUILD_SESSION_SECRET, ctx.now);
}

export function githubSessionOf(request: Request, ctx: BuildContext): Promise<GitHubSession | null> {
  return signerFor(ctx).readSession(readCookie(request, GITHUB_SESSION_COOKIE));
}

export function visibilityGrantOf(request: Request): string | null {
  return readCookie(request, GITHUB_VISIBILITY_GRANT_COOKIE)?.trim() || null;
}

function setSessionCookie(response: Response, ctx: BuildContext, token: string): void {
  appendCookie(
    response,
    serializeCookie(GITHUB_SESSION_COOKIE, token, { secure: ctx.secureCookies, maxAge: SESSION_TTL_SECONDS }),
  );
}

export function clearSessionCookie(response: Response, ctx: BuildContext): void {
  appendCookie(response, serializeCookie(GITHUB_SESSION_COOKIE, "", { secure: ctx.secureCookies, maxAge: 0 }));
}

function setVisibilityGrantCookie(response: Response, ctx: BuildContext, grant: string | null): void {
  const value = grant?.trim() ?? "";
  appendCookie(
    response,
    serializeCookie(GITHUB_VISIBILITY_GRANT_COOKIE, value, {
      secure: ctx.secureCookies,
      maxAge: value ? VISIBILITY_GRANT_TTL_SECONDS : 0,
    }),
  );
}

function clearOAuthRequestCookie(response: Response, ctx: BuildContext): void {
  appendCookie(
    response,
    serializeCookie(GITHUB_OAUTH_REQUEST_COOKIE, "", { secure: ctx.secureCookies, maxAge: 0 }),
  );
}

function redirect(location: URL): Response {
  return new Response(null, { status: 302, headers: { location: location.toString() } });
}


function validLoopbackRedirect(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/callback"
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function validOpaque(value: string | null, min: number, max: number): value is string {
  return Boolean(value && value.length >= min && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value));
}

export function parseCliLoginRequest(url: URL): GitHubCliLoginRequest | null {
  const redirectUri = validLoopbackRedirect(url.searchParams.get("redirect_uri"));
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  return redirectUri && validOpaque(state, 32, 128) && validOpaque(codeChallenge, 43, 128)
    ? { redirectUri: redirectUri.toString(), state, codeChallenge }
    : null;
}

async function startGitHubOAuth(
  request: Request,
  ctx: BuildContext,
  continuation: GitHubOAuthContinuation,
): Promise<Response> {
  const oauthState = randomHex(32);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set(
    "client_id",
    // The one-shot App OAuth client ids (app index 2). Their secrets stay in
    // Manager's index-2 config; the ids are public.
    ctx.production ? "Iv23li4wPpAfoGOJ6v0Q" : "Iv23lilgvJz13pJekLSZ",
  );
  authorize.searchParams.set("redirect_uri", new URL(GITHUB_CALLBACK_PATH, ctx.buildOrigin).toString());
  authorize.searchParams.set("state", oauthState);
  const response = redirect(authorize);
  appendCookie(
    response,
    serializeCookie(
      GITHUB_OAUTH_REQUEST_COOKIE,
      await signerFor(ctx).issueOAuthRequest({ oauthState, continuation }),
      { secure: ctx.secureCookies, maxAge: OAUTH_REQUEST_TTL_SECONDS },
    ),
  );
  void request;
  return response;
}

async function finishCliAuthorization(
  ctx: BuildContext,
  session: GitHubSession,
  login: GitHubCliLoginRequest,
): Promise<Response> {
  const target = new URL(login.redirectUri);
  target.searchParams.set("code", await signerFor(ctx).issueCliExchange(session, login.codeChallenge));
  target.searchParams.set("state", login.state);
  return redirect(target);
}

// ── /api/bff/auth/github/* ───────────────────────────────────────────────────

/** GET /api/bff/auth/github/login — the single entrypoint for GitHub OAuth. */
export async function login(request: Request, ctx: BuildContext): Promise<Response> {
  const params = new URL(request.url).searchParams;
  if (params.get("resume") === "template") {
    const platform = params.get("platform");
    if (!platform || !PLATFORM_PATTERN.test(platform))
      return Response.json({ error: "Invalid platform" }, { status: 400 });
    return startGitHubOAuth(request, ctx, { kind: "template", platform });
  }
  return startGitHubOAuth(request, ctx, { kind: "browser" });
}

/**
 * GET /api/bff/auth/github/claim?projectId — the project viewer is the entry
 * point for Claim. GitHub OAuth only starts after this explicit click.
 */
export async function claim(request: Request, ctx: BuildContext): Promise<Response> {
  const session = await githubSessionOf(request, ctx);
  if (!session) return Response.json({ error: "not signed in with GitHub" }, { status: 401 });
  const projectId = Number(new URL(request.url).searchParams.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0)
    return Response.json({ error: "invalid projectId" }, { status: 400 });
  return startGitHubOAuth(request, ctx, { kind: "claim", projectId });
}

function browserReturnUrl(ctx: BuildContext, continuation: GitHubOAuthContinuation | undefined): URL {
  if (continuation?.kind === "template") {
    const url = new URL("/operate/deployments/new", ctx.buildOrigin);
    url.searchParams.set("platform", continuation.platform);
    url.searchParams.set("mode", "template");
    return url;
  }
  const url = new URL("/operate/deployments", ctx.buildOrigin);
  url.searchParams.set("launch", "github");
  return url;
}

function oauthError(
  ctx: BuildContext,
  continuation: GitHubOAuthContinuation | undefined,
  error: string,
): Response {
  const cli = continuation?.kind === "cli";
  const target = cli ? new URL(continuation.redirectUri) : browserReturnUrl(ctx, continuation);
  target.searchParams.set(cli ? "error" : "github_error", error);
  if (cli) target.searchParams.set("state", continuation.state);
  return redirect(target);
}

/** GET /api/bff/auth/github/callback — the only GitHub OAuth callback. */
export async function callback(request: Request, ctx: BuildContext): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const signer = signerFor(ctx);
  const oauthRequest = await signer.readOAuthRequest(readCookie(request, GITHUB_OAUTH_REQUEST_COOKIE));
  if (!code || !state || !oauthRequest || state !== oauthRequest.oauthState)
    return oauthError(ctx, oauthRequest?.continuation, "invalid_oauth_state");
  const { continuation } = oauthRequest;
  const redirectUri = new URL(GITHUB_CALLBACK_PATH, ctx.buildOrigin).toString();

  try {
    if (continuation.kind === "claim") {
      const existing = await githubSessionOf(request, ctx);
      if (!existing) return oauthError(ctx, continuation, "not_signed_in");
      const claimed = await (await managerClient(request, ctx)).claimGitHubProject({
        code,
        projectId: continuation.projectId,
        redirectUri,
      });
      if (claimed.githubUserId !== existing.githubUserId)
        return oauthError(ctx, continuation, "github_account_changed");
      const response = redirect(new URL(`/projects/${continuation.projectId}?claim=success`, ctx.buildOrigin));
      clearOAuthRequestCookie(response, ctx);
      return response;
    }
    const identity = await (await managerClient(request, ctx)).exchangeGitHubCode({
      code,
      app: GITHUB_LOGIN_APP_INDEX,
      redirectUri,
    });
    if (!identity.githubUserId) throw new Error("GitHub identity could not be resolved");
    const session: GitHubSession = {
      githubUserId: identity.githubUserId,
      githubLogin: identity.githubLogin,
      installationId: identity.installationId,
    };
    const response =
      continuation.kind === "cli"
        ? await finishCliAuthorization(ctx, session, continuation)
        : redirect(browserReturnUrl(ctx, continuation));
    clearOAuthRequestCookie(response, ctx);
    setSessionCookie(response, ctx, await signer.issueSession(session));
    setVisibilityGrantCookie(response, ctx, identity.visibilityGrant ?? null);
    return response;
  } catch (error) {
    console.error("edge.build.github_oauth_exchange_failed", {
      operation: "github.oauth_exchange",
      continuation: continuation.kind,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return oauthError(
      ctx,
      continuation,
      error instanceof BackendError && error.status === 403 ? "service_auth_forbidden" : "exchange_failed",
    );
  }
}

/** GET /api/bff/auth/github/status — what the client needs to gate the UI. */
export async function status(request: Request, ctx: BuildContext): Promise<Response> {
  const session = await githubSessionOf(request, ctx);
  return Response.json({
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

/** POST /api/bff/auth/github/signout — drop the Aomi Build GitHub session. */
export function signout(_request: Request, ctx: BuildContext): Response {
  const response = Response.json({ ok: true });
  clearSessionCookie(response, ctx);
  return response;
}

// ── /api/bff/cli/* ───────────────────────────────────────────────────────────

/** GET /api/bff/cli/login — authorize the CLI from the existing browser session. */
export async function cliLogin(request: Request, ctx: BuildContext): Promise<Response> {
  const login = parseCliLoginRequest(new URL(request.url));
  if (!login) return Response.json({ error: "invalid CLI login request" }, { status: 400 });
  const session = await githubSessionOf(request, ctx);
  return session
    ? finishCliAuthorization(ctx, session, login)
    : startGitHubOAuth(request, ctx, { kind: "cli", ...login });
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** POST /api/bff/cli/exchange { code, codeVerifier } — loopback code → CLI bearer. */
export async function cliExchange(request: Request, ctx: BuildContext): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { code?: unknown; codeVerifier?: unknown };
  if (
    typeof body.code !== "string" ||
    typeof body.codeVerifier !== "string" ||
    body.codeVerifier.length < 43 ||
    body.codeVerifier.length > 128
  )
    return Response.json({ error: "invalid CLI exchange request" }, { status: 400 });
  const exchange = await signerFor(ctx).readCliExchange(body.code);
  if (!exchange || (await pkceChallenge(body.codeVerifier)) !== exchange.codeChallenge)
    return Response.json({ error: "CLI login code was rejected" }, { status: 401 });
  return Response.json({
    accessToken: exchange.accessToken,
    tokenType: "Bearer",
    expiresIn: CLI_SESSION_TTL_SECONDS,
    githubLogin: exchange.session.githubLogin,
    githubUserId: exchange.session.githubUserId,
  });
}

/** GET /api/bff/cli/status — validate a saved CLI bearer without exposing it. */
export async function cliStatus(request: Request, ctx: BuildContext): Promise<Response> {
  const session = await signerFor(ctx).readCliSession(bearerOf(request));
  if (!session) return Response.json({ signedIn: false }, { status: 401 });
  return Response.json({ signedIn: true, githubLogin: session.githubLogin, githubUserId: session.githubUserId });
}
