import { appendCookie } from "@/server/http-response";
import { redirectResponse } from "@/server/http-response";
import "@tanstack/react-start/server-only";

import { randomBytes } from "crypto";

import { API_PATHS } from "@/lib/api-paths";
import { backendClient } from "@/server/bff/backend";
import { secureCookies } from "@/server/env";
import {
  type GitHubCliLoginRequest,
  type GitHubOAuthContinuation,
  type GitHubSession,
  issueGitHubCliExchange,
  issueGitHubOAuthRequest,
} from "@/server/cookies/github";
import {
  GITHUB_LOGIN_APP_INDEX,
  githubOAuthClientId,
} from "@/server/github-oauth-config";

export const GITHUB_OAUTH_REQUEST_COOKIE = "aomi_github_oauth_request";

const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: secureCookies(),
  sameSite: "lax" as const,
  path: "/",
  maxAge: 10 * 60,
};

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
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function validOpaque(value: string | null, min: number, max: number): boolean {
  return Boolean(
    value &&
    value.length >= min &&
    value.length <= max &&
    /^[A-Za-z0-9_-]+$/.test(value),
  );
}

export function parseCliLoginRequest(url: URL): GitHubCliLoginRequest | null {
  const redirectUri = validLoopbackRedirect(
    url.searchParams.get("redirect_uri"),
  );
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  return redirectUri &&
    validOpaque(state, 32, 128) &&
    validOpaque(codeChallenge, 43, 128)
    ? {
        redirectUri: redirectUri.toString(),
        state: state!,
        codeChallenge: codeChallenge!,
      }
    : null;
}

export async function startGitHubOAuth(
  req: Request,
  continuation: GitHubOAuthContinuation,
): Promise<Response> {
  const requestUrl = new URL(req.url);
  const oauthState = randomBytes(32).toString("hex");
  const callback = new URL(
    API_PATHS.bff.auth.github.callback,
    requestUrl.origin,
  );
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", githubOAuthClientId(req));
  authorize.searchParams.set("redirect_uri", callback.toString());
  authorize.searchParams.set("state", oauthState);

  const response = redirectResponse(authorize);
  appendCookie(
    response,
    GITHUB_OAUTH_REQUEST_COOKIE,
    await issueGitHubOAuthRequest({ oauthState, continuation }),
    OAUTH_COOKIE_OPTIONS,
  );
  return response;
}

export async function exchangeGitHubSession(
  code: string,
  origin: string,
): Promise<{ session: GitHubSession; visibilityGrant: string | null }> {
  const callback = new URL(API_PATHS.bff.auth.github.callback, origin);
  const identity = await (
    await backendClient()
  ).exchangeGitHubCode({
    code,
    app: GITHUB_LOGIN_APP_INDEX,
    redirectUri: callback.toString(),
  });
  if (!identity.githubUserId) {
    throw new Error("GitHub identity could not be resolved");
  }
  return {
    session: {
      githubUserId: identity.githubUserId,
      githubLogin: identity.githubLogin,
      installationId: identity.installationId,
    },
    visibilityGrant: identity.visibilityGrant ?? null,
  };
}

export async function finishCliAuthorization(
  session: GitHubSession,
  request: GitHubCliLoginRequest,
): Promise<Response> {
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set(
    "code",
    await issueGitHubCliExchange(session, request.codeChallenge),
  );
  redirect.searchParams.set("state", request.state);
  return redirectResponse(redirect);
}

export function clearGitHubOAuthRequest(response: Response): void {
  appendCookie(response, GITHUB_OAUTH_REQUEST_COOKIE, "", {
    ...OAUTH_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
