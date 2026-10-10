import { redirectResponse } from "@/server/http-response";
import { getCookie } from "@tanstack/react-start/server";
import {
  type GitHubOAuthContinuation,
  readGitHubOAuthRequest,
  getGitHubSession,
  setGitHubVisibilityGrantCookie,
  setGitHubSessionCookie,
  clearGitHubSessionCookie,
} from "@/server/cookies/github";
import {
  GITHUB_OAUTH_REQUEST_COOKIE,
  clearGitHubOAuthRequest,
  exchangeGitHubSession,
  finishCliAuthorization,
  startGitHubOAuth,
} from "@/server/github-auth";
import { buildFailures } from "@/server/bff/failures";
import { API_PATHS } from "@/lib/api-paths";
import { authorize } from "@/server/bff/auth";
import { devToolsAllowed } from "@/server/env";

function deploymentsUrl(req: Request): URL {
  const url = new URL("/operate/deployments", req.url);
  url.searchParams.set("launch", "github");
  return url;
}

function browserReturnUrl(
  req: Request,
  continuation: GitHubOAuthContinuation | undefined,
): URL {
  if (continuation?.kind !== "template") return deploymentsUrl(req);
  const url = new URL("/operate/deployments/new", req.url);
  url.searchParams.set("platform", continuation.platform);
  url.searchParams.set("mode", "template");
  return url;
}

function oauthError(
  req: Request,
  continuation: GitHubOAuthContinuation | undefined,
  error: string,
): Response {
  const cli = continuation?.kind === "cli";
  const redirect = cli
    ? new URL(continuation.redirectUri)
    : browserReturnUrl(req, continuation);
  redirect.searchParams.set(cli ? "error" : "github_error", error);
  if (cli) redirect.searchParams.set("state", continuation.state);
  return redirectResponse(redirect);
}

// The only GitHub OAuth callback. Browser login ends in Build; CLI login resumes
// the signed loopback continuation after minting the same browser session.
export async function githubCallbackRoute(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthRequest = await readGitHubOAuthRequest(
    getCookie(GITHUB_OAUTH_REQUEST_COOKIE),
  );
  const pendingContinuation = oauthRequest?.continuation;

  if (!code || !state || !oauthRequest || state !== oauthRequest.oauthState) {
    return oauthError(req, pendingContinuation, "invalid_oauth_state");
  }
  const continuation = oauthRequest.continuation;

  try {
    if (continuation.kind === "claim") {
      const existingSession = await getGitHubSession();
      if (!existingSession) {
        return oauthError(req, continuation, "not_signed_in");
      }
      const claimed = await (await import("@/server/bff/backend"))
        .backendClient()
        .then((client) =>
          client.claimGitHubProject({
            code,
            projectId: continuation.projectId,
            redirectUri: new URL(
              API_PATHS.bff.auth.github.callback,
              url.origin,
            ).toString(),
          }),
        );
      if (claimed.githubUserId !== existingSession.githubUserId) {
        return oauthError(req, continuation, "github_account_changed");
      }
      const response = redirectResponse(
        new URL(`/projects/${continuation.projectId}?claim=success`, req.url),
      );
      clearGitHubOAuthRequest(response);
      return response;
    }
    const { session, visibilityGrant } = await exchangeGitHubSession(
      code,
      url.origin,
    );
    const response =
      continuation.kind === "cli"
        ? await finishCliAuthorization(session, continuation)
        : redirectResponse(browserReturnUrl(req, continuation));
    clearGitHubOAuthRequest(response);
    await setGitHubSessionCookie(response, session);
    setGitHubVisibilityGrantCookie(response, visibilityGrant);
    return response;
  } catch (error) {
    const failure = buildFailures.handle({
      source: "launch",
      error,
      context: {
        routeFamily: "/api/bff/auth/github/callback",
        operation: "github.oauth_exchange",
        method: req.method,
      },
    });
    return oauthError(
      req,
      continuation,
      failure.reason === "service_credential_rejected" &&
        failure.upstreamStatus === 403
        ? "service_auth_forbidden"
        : "exchange_failed",
    );
  }
}

// The project viewer is intentionally the entry point for Claim. GitHub OAuth
// only starts after this explicit click; loading an org project never prompts.
export async function githubClaimRoute(req: Request) {
  const auth = await authorize(req);
  if ("response" in auth) return auth.response;
  const projectId = Number(new URL(req.url).searchParams.get("projectId"));
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return Response.json({ error: "invalid projectId" }, { status: 400 });
  }
  return startGitHubOAuth(req, { kind: "claim", projectId });
}

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
export async function githubDevSessionRoute(req: Request) {
  if (!devToolsAllowed() || !isLocalhost(req)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const login = url.searchParams.get("login")?.trim();
  if (!login) {
    return Response.json({ error: "missing `login`" }, { status: 400 });
  }

  try {
    const explicitId = url.searchParams.get("id")?.trim();
    const githubUserId =
      explicitId && /^\d+$/.test(explicitId)
        ? explicitId
        : await resolveGitHubUserId(login);
    const res = redirectResponse(settingsUrl(req));
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

// GET /api/bff/auth/github/login — the single entrypoint for GitHub OAuth.
export async function githubLoginRoute(req: Request) {
  const params = new URL(req.url).searchParams;
  if (params.get("resume") === "template") {
    const platform = params.get("platform");
    if (!platform || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,99}$/.test(platform)) {
      return Response.json({ error: "Invalid platform" }, { status: 400 });
    }
    return startGitHubOAuth(req, { kind: "template", platform });
  }
  return startGitHubOAuth(req, { kind: "browser" });
}

// POST /api/bff/auth/github/signout — drop the Aomi Build GitHub session.
export async function githubSignoutRoute() {
  const res = Response.json({ ok: true });
  clearGitHubSessionCookie(res);
  return res;
}

// GET /api/bff/auth/github/status — what the client needs to gate the UI: whether
// a GitHub session exists and its login. The github_user_id stays server-side.
export async function githubSessionRoute() {
  const session = await getGitHubSession();
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
