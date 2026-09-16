import {
  aomiOAuthResources,
  listManagedWidgetOrigins,
  readManagedOAuthClient,
} from "@aomi-labs/account/better-auth";

const ALLOWED_REQUEST_HEADERS = new Set([
  "authorization",
  "content-type",
  "dpop",
  "idempotency-key",
  "last-event-id",
  "payment-signature",
  "x-session-id",
  "x-thread-id",
]);
const EXPOSED_RESPONSE_HEADERS = [
  "DPoP-Nonce",
  "WWW-Authenticate",
  "Payment-Required",
  "Payment-Response",
  "X-Payment-Response",
  "X-Request-Id",
];

export function publicDiscoveryResponse(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.headers.delete("Access-Control-Allow-Credentials");
  return response;
}

export async function managedWidgetPreflight(
  request: Request,
  methods: readonly string[],
): Promise<Response> {
  const origin = normalizedOrigin(request.headers.get("origin"));
  const enabled = origin
    ? (await listManagedWidgetOrigins()).includes(origin)
    : false;
  if (!origin || !enabled) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  const requestedHeaders = (
    request.headers.get("access-control-request-headers") ?? ""
  )
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !ALLOWED_REQUEST_HEADERS.has(header))) {
    return Response.json({ error: "headers_not_allowed" }, { status: 403 });
  }
  const response = new Response(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", methods.join(", "));
  response.headers.set(
    "Access-Control-Allow-Headers",
    requestedHeaders.join(", "),
  );
  response.headers.set("Access-Control-Max-Age", "600");
  applyOriginHeaders(response, origin);
  return response;
}

export async function isManagedWidgetClientOrigin(
  originValue: string | null,
  clientId: string | undefined,
): Promise<boolean> {
  const origin = normalizedOrigin(originValue);
  if (!origin || !clientId) return false;
  const client = await readManagedOAuthClient(clientId);
  return Boolean(
    client &&
    !client.disabled &&
    client.clientClass === "partner_widget" &&
    client.origins.includes(origin),
  );
}

export async function applyManagedWidgetCors(input: {
  request: Request;
  response: Response;
  clientId: string | undefined;
}): Promise<Response> {
  const origin = normalizedOrigin(input.request.headers.get("origin"));
  if (!origin) return input.response;
  if (origin === aomiOAuthResources().portalOrigin) return input.response;
  if (!(await isManagedWidgetClientOrigin(origin, input.clientId))) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  applyOriginHeaders(input.response, origin);
  return input.response;
}

/** Adds readable CORS headers to generic auth challenges without trusting
 * unverified token claims for a client ID. The origin must still belong to at
 * least one enabled managed widget; successful responses use the stricter
 * client+origin binding above. */
export async function applyManagedWidgetOriginCors(input: {
  request: Request;
  response: Response;
}): Promise<Response> {
  const origin = normalizedOrigin(input.request.headers.get("origin"));
  if (!origin) return input.response;
  if (origin === aomiOAuthResources().portalOrigin) return input.response;
  if (!(await listManagedWidgetOrigins()).includes(origin)) {
    return Response.json({ error: "origin_not_allowed" }, { status: 403 });
  }
  applyOriginHeaders(input.response, origin);
  return input.response;
}

export async function oauthBodyClientId(
  request: Request,
): Promise<string | undefined> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (type.includes("application/x-www-form-urlencoded")) {
    return (
      new URLSearchParams(await request.clone().text()).get("client_id") ??
      undefined
    );
  }
  if (type.includes("application/json")) {
    const body = (await request
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    return typeof body?.client_id === "string" ? body.client_id : undefined;
  }
  return undefined;
}

function applyOriginHeaders(response: Response, origin: string): void {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set(
    "Access-Control-Expose-Headers",
    EXPOSED_RESPONSE_HEADERS.join(", "),
  );
  response.headers.delete("Access-Control-Allow-Credentials");
  appendVary(response.headers, "Origin");
}

function appendVary(headers: Headers, value: string): void {
  const values = new Set(
    (headers.get("Vary") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  values.add(value);
  headers.set("Vary", [...values].join(", "));
}

function normalizedOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin === value ? value : null;
  } catch {
    return null;
  }
}
