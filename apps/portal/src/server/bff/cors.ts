import { listManagedWidgetOrigins, readManagedOAuthClient } from "@aomi-labs/account/better-auth/core";

import { observedWidgetOrigin } from "@aomi-labs/account/widget-auth";

import { portalOrigins } from "@/server/env";

const EXPOSED_HEADERS = [
  "DPoP-Nonce",
  "WWW-Authenticate",
  "Payment-Required",
  "Payment-Receipt",
  "Payment-Response",
  "X-Payment-Response",
  "Retry-After",
  "X-Request-Id",
];

/**
 * Open widget policy: any https site (or a local dev host) may embed the widget
 * without registering. Responses never allow credentials, so only an explicit
 * widget session or OAuth token can authorize a cross-origin call.
 */
export const openWidget = {
  allowedHeaders: [
    "Authorization",
    "Content-Type",
    "Aomi-App-Key",
    "Last-Event-ID",
    "DPoP",
    "Idempotency-Key",
    "Payment-Signature",
    "X-Aomi-Inference-Funding",
    "X-Aomi-CSRF",
    "X-Request-Id",
    "X-Session-Id",
    "X-Thread-Id",
  ],

  apply(request: Request, response: Response): Response {
    const origin = observedWidgetOrigin(request);
    // With no usable origin there is nothing to echo, but the caller must still
    // be able to read why it was refused; these responses carry no credentials.
    if (!origin) return allowAnyOrigin(response);
    return allowOrigin(response, origin);
  },

  preflight(request: Request, methods: readonly string[]): Response {
    const response = openWidget.apply(
      request,
      new Response(null, { status: 204 }),
    );
    response.headers.set(
      "Access-Control-Allow-Methods",
      [...methods, "OPTIONS"].join(", "),
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      openWidget.allowedHeaders.join(", "),
    );
    response.headers.set("Access-Control-Max-Age", "600");
    return response;
  },
};

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

/**
 * Managed OAuth client policy: a registered partner widget may call the token
 * endpoints from the origins it registered, and only those.
 */
export const managedClient = {
  async preflight(
    request: Request,
    methods: readonly string[],
  ): Promise<Response> {
    const origin = exactOrigin(request.headers.get("origin"));
    if (!origin || !(await listManagedWidgetOrigins()).includes(origin))
      return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    const requested = (
      request.headers.get("access-control-request-headers") ?? ""
    )
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);
    if (requested.some((header) => !MANAGED_CLIENT_HEADERS.has(header)))
      return Response.json({ error: "headers_not_allowed" }, { status: 403 });
    const response = allowOrigin(new Response(null, { status: 204 }), origin);
    response.headers.set("Access-Control-Allow-Methods", methods.join(", "));
    response.headers.set("Access-Control-Allow-Headers", requested.join(", "));
    response.headers.set("Access-Control-Max-Age", "600");
    return response;
  },

  /** Cross-origin token responses go only to the origin bound to that client. */
  async apply(
    request: Request,
    response: Response,
    clientId: string | undefined,
  ): Promise<Response> {
    const origin = exactOrigin(request.headers.get("origin"));
    if (!origin || isPortalOrigin(request, origin)) return response;
    if (!(await isManagedWidgetClientOrigin(origin, clientId)))
      return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    return allowOrigin(response, origin);
  },
};

/** Public policy: credential-free documents anyone may read (catalogs, JWKS, discovery). */
export const publicRead = {
  apply(
    response: Response,
    methods: readonly string[] = ["GET", "HEAD"],
  ): Response {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set(
      "Access-Control-Allow-Methods",
      [...methods, "OPTIONS"].join(", "),
    );
    response.headers.delete("Access-Control-Allow-Credentials");
    return response;
  },
};

export async function isManagedWidgetClientOrigin(
  originValue: string | null,
  clientId: string | undefined,
): Promise<boolean> {
  const origin = exactOrigin(originValue);
  if (!origin || !clientId) return false;
  const client = await readManagedOAuthClient(clientId);
  return Boolean(
    client &&
    !client.disabled &&
    client.clientClass === "partner_widget" &&
    client.origins.includes(origin),
  );
}

function allowOrigin(response: Response, origin: string): Response {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set(
    "Access-Control-Expose-Headers",
    EXPOSED_HEADERS.join(", "),
  );
  response.headers.delete("Access-Control-Allow-Credentials");
  const vary = new Set(
    (response.headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  vary.add("Origin");
  response.headers.set("Vary", [...vary].join(", "));
  return response;
}

function allowAnyOrigin(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.delete("Access-Control-Allow-Credentials");
  return response;
}

function exactOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin === value ? value : null;
  } catch {
    return null;
  }
}

function isPortalOrigin(request: Request, origin: string): boolean {
  return (
    origin === new URL(request.url).origin || portalOrigins().includes(origin)
  );
}
