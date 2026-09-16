import {
  BETTER_AUTH_OAUTH_PROVIDER_VERSION,
  auth,
  aomiOAuthResources,
  guestScopesForAomiResource,
  hashOAuthClientId,
  oauthRedirectFailureDiagnostics,
} from "@aomi-labs/account/better-auth";

import {
  applyManagedWidgetCors,
  isManagedWidgetClientOrigin,
  managedWidgetPreflight,
  oauthBodyClientId,
  publicDiscoveryResponse,
} from "@portal/server/oauth/cors";
import { enforceAomiOAuthRequestPolicy } from "@portal/server/oauth/request-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleAuth(request: Request) {
  const path = new URL(request.url).pathname;
  const isBrowserGrantEndpoint = ["/oauth2/token", "/oauth2/revoke"].some(
    (suffix) => path.endsWith(suffix),
  );
  const origin = request.headers.get("origin");
  const crossOrigin =
    origin !== null && origin !== aomiOAuthResources().portalOrigin;
  const browserClientId =
    isBrowserGrantEndpoint && crossOrigin
      ? await oauthBodyClientId(request)
      : undefined;
  if (
    isBrowserGrantEndpoint &&
    crossOrigin &&
    !(await isManagedWidgetClientOrigin(origin, browserClientId))
  ) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  const policy = await enforceAomiOAuthRequestPolicy(request);
  if (policy.kind === "reject") return policy.response;
  request = policy.request;
  if (request.method === "POST" && path.endsWith("/sign-in/anonymous")) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session) {
      return Response.json({ code: "session_exists" }, { status: 409 });
    }
  }
  if (request.method === "POST" && path.endsWith("/oauth2/consent")) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user.isAnonymous === true) {
      const body = (await request
        .clone()
        .json()
        .catch(() => null)) as Record<string, unknown> | null;
      const requested = String(body?.scope ?? "")
        .split(/\s+/)
        .filter(Boolean);
      if (!body || requested.length === 0) {
        return Response.json(
          {
            error: "invalid_request",
            error_description:
              "Guest consent must explicitly select its bounded scopes",
          },
          { status: 400 },
        );
      }
      const oauthQuery =
        typeof body.oauth_query === "string"
          ? new URLSearchParams(body.oauth_query)
          : null;
      const consentResources = oauthQuery?.getAll("resource") ?? [];
      const oidcOnly =
        consentResources.length === 0 &&
        requested.includes("openid") &&
        requested.every((scope) =>
          ["openid", "profile", "email", "offline_access"].includes(scope),
        );
      if (oidcOnly) {
        // Identity-only consent is intentionally separate from Aomi resource
        // grants and remains governed by Better Auth's signed OAuth query.
      } else {
        if (consentResources.length !== 1) {
          return Response.json(
            {
              error: "invalid_target",
              error_description: "Guest consent requires one signed resource",
            },
            { status: 400 },
          );
        }
        const resource = consentResources[0];
        const bounded = guestScopesForAomiResource(resource, requested);
        if (bounded.length === 0) {
          return Response.json(
            {
              error: "invalid_scope",
              error_description: "No guest-safe scope selected",
            },
            { status: 400 },
          );
        }
        request = new Request(request, {
          body: JSON.stringify({ ...body, scope: bounded.join(" ") }),
        });
      }
    }
  }
  let response = await auth.handler(request);
  if (request.method === "GET" && path.endsWith("/jwks")) {
    response = publicDiscoveryResponse(response);
  }
  if (isBrowserGrantEndpoint && crossOrigin) {
    response = await applyManagedWidgetCors({
      request,
      response,
      clientId: browserClientId,
    });
  }
  if (
    request.method === "GET" &&
    path.endsWith("/oauth2/authorize") &&
    ["invalid_redirect", "invalid_request"].includes(
      (await oauthResponseError(response)) ?? "",
    ) &&
    new URL(request.url).searchParams.has("client_id") &&
    new URL(request.url).searchParams.has("redirect_uri")
  ) {
    await observeOAuthRedirectFailure(request);
  }
  if (isObservedOAuthPath(path)) {
    console.info("better_auth_oauth_endpoint", {
      endpoint: path.slice(path.lastIndexOf("/api/auth") + "/api/auth".length),
      method: request.method,
      resultClass:
        response.status < 400
          ? "success"
          : response.status < 500
            ? "client_error"
            : "server_error",
      status: response.status,
    });
  }
  return response;
}

async function observeOAuthRedirectFailure(request: Request): Promise<void> {
  const query = new URL(request.url).searchParams;
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
  const deploymentSha =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local";
  try {
    console.warn("better_auth_oauth_redirect_rejected", {
      ...(await oauthRedirectFailureDiagnostics(clientId, redirectUri)),
      betterAuthVersion: BETTER_AUTH_OAUTH_PROVIDER_VERSION,
      deploymentSha,
      diagnosticsAvailable: true,
    });
  } catch {
    console.warn("better_auth_oauth_redirect_rejected", {
      clientIdHash: hashOAuthClientId(clientId),
      betterAuthVersion: BETTER_AUTH_OAUTH_PROVIDER_VERSION,
      deploymentSha,
      diagnosticsAvailable: false,
    });
  }
}

async function oauthResponseError(response: Response): Promise<string | null> {
  const location = response.headers.get("location");
  if (location) {
    try {
      return new URL(location, "https://oauth.invalid").searchParams.get(
        "error",
      );
    } catch {
      return null;
    }
  }
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { url?: unknown } | null;
  if (typeof body?.url !== "string") return null;
  try {
    return new URL(body.url, "https://oauth.invalid").searchParams.get("error");
  } catch {
    return null;
  }
}

function isObservedOAuthPath(path: string): boolean {
  return ["/oauth2/", "/device/", "/jwks"].some((part) => path.includes(part));
}

export const GET = handleAuth;
export const POST = handleAuth;
export const PUT = handleAuth;
export const PATCH = handleAuth;
export const DELETE = handleAuth;

export async function OPTIONS(request: Request) {
  const path = new URL(request.url).pathname;
  if (
    ["/oauth2/token", "/oauth2/revoke"].some((suffix) => path.endsWith(suffix))
  ) {
    return managedWidgetPreflight(request, ["POST", "OPTIONS"]);
  }
  if (path.endsWith("/jwks")) {
    return publicDiscoveryResponse(new Response(null, { status: 204 }));
  }
  return new Response(null, { status: 204 });
}
