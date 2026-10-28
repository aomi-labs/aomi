import {
  BETTER_AUTH_OAUTH_PROVIDER_VERSION,
  handleWalletAuthRequest,
  aomiOAuthResources,
  guestScopesForAomiResource,
  hashOAuthClientId,
  listManagedWidgetOrigins,
  oauthRedirectFailureDiagnostics,
} from "@aomi-labs/account/better-auth";

import { config } from "../kernel/config";
import { observedOrigin, openWidget, preflight, publicRead, withCors } from "../kernel/cors";
import type { PortalContext } from "../portal/context";
import { isManagedWidgetClientOrigin } from "../portal/principal";
import {
  enforceAomiOAuthRequestPolicy,
  oauthClientId,
} from "./oauth/request-policy";

const MANAGED_CLIENT_HEADERS = new Set([
  "authorization",
  "content-type",
  "dpop",
  "idempotency-key",
  "last-event-id",
  "payment-signature",
  "x-session-id",
  "x-thread-id",
]);

const isGrantEndpoint = (path: string) =>
  ["/oauth2/token", "/oauth2/revoke"].some((suffix) => path.endsWith(suffix));

/**
 * Better Auth under /api/auth, behind Aomi's OAuth request policy. A
 * registered partner widget may call the token endpoints from the origins it
 * registered, and only those.
 */
export async function handleBetterAuth(request: Request, ctx: PortalContext): Promise<Response> {
  if (request.method === "OPTIONS") return authPreflight(request, ctx);
  const auth = ctx.auth();
  const path = new URL(request.url).pathname;
  const isBrowserGrantEndpoint = isGrantEndpoint(path);
  if (isBrowserGrantEndpoint) {
    // DPoP binds to the configured public endpoint, never the transport host.
    const publicUrl = new URL(aomiOAuthResources().portalOrigin);
    publicUrl.pathname = path;
    publicUrl.search = new URL(request.url).search;
    request = new Request(publicUrl, request);
  }
  const origin = request.headers.get("origin");
  const crossOrigin =
    origin !== null && origin !== aomiOAuthResources().portalOrigin;
  const browserClientId =
    isBrowserGrantEndpoint && crossOrigin
      ? await oauthClientId(request)
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
  let response =
    request.method === "POST" && /\/siw(?:e|s)\/(?:nonce|verify)$/.test(path)
      ? await handleWalletAuthRequest(auth, request)
      : await auth.handler(request);
  if (request.method === "GET" && path.endsWith("/jwks"))
    response = withCors(publicRead(), request, response, config(ctx.env));
  // Cross-origin token responses go only to the origin bound to that client
  // (checked above), so the grant can be read there.
  if (isBrowserGrantEndpoint && crossOrigin)
    response = withCors(openWidget(["POST"]), request, response, config(ctx.env));
  if (
    request.method === "GET" &&
    path.endsWith("/oauth2/authorize") &&
    ["invalid_redirect", "invalid_request"].includes(
      (await oauthResponseError(response)) ?? "",
    ) &&
    new URL(request.url).searchParams.has("client_id") &&
    new URL(request.url).searchParams.has("redirect_uri")
  ) {
    await observeOAuthRedirectFailure(request, ctx.env.CF_VERSION_METADATA?.id ?? "local");
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

async function observeOAuthRedirectFailure(request: Request, deploymentSha: string): Promise<void> {
  const query = new URL(request.url).searchParams;
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";
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

async function authPreflight(request: Request, ctx: PortalContext): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path.endsWith("/jwks")) return preflight(publicRead(), request, config(ctx.env));
  if (!isGrantEndpoint(path)) return new Response(null, { status: 204 });
  const origin = observedOrigin(request);
  if (!origin || !(await listManagedWidgetOrigins()).includes(origin))
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  const requested = (request.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requested.some((header) => !MANAGED_CLIENT_HEADERS.has(header)))
    return Response.json({ error: "headers_not_allowed" }, { status: 403 });
  return preflight(openWidget(["POST"]), request, config(ctx.env));
}
