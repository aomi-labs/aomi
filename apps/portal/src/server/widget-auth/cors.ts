import { observedWidgetOrigin } from "@aomi-labs/account/widget-auth";

const ALLOWED_HEADERS = [
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
];

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

export function widgetCorsPreflight(
  request: Request,
  allowedMethods: readonly string[],
): Response {
  if (!observedWidgetOrigin(request)) {
    // A browser will not expose a failed preflight response. Let the actual
    // credential-free request proceed so the route can return its readable 403.
    return applyPreflightHeaders(
      withReadableRejection(new Response(null, { status: 204 })),
      allowedMethods,
    );
  }
  return applyWidgetCors(request, new Response(null, { status: 204 }), {
    allowedMethods,
    preflight: true,
  });
}

/** Let the browser read a rejection whose origin we refused to echo.
 *
 *  Without this, an origin rejection reaches the page as an opaque CORS/network
 *  failure rather than its own 403 body — the caller cannot tell "your origin is
 *  not usable" from "the server is down". A wildcard is safe here and only here:
 *  these responses carry no credentials (`Access-Control-Allow-Credentials` is
 *  never set on this surface) and no data beyond the error code itself. */
function withReadableRejection(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}

export function applyWidgetCors(
  request: Request,
  response: Response,
  options?: { allowedMethods?: readonly string[]; preflight?: boolean },
): Response {
  const origin = observedWidgetOrigin(request);
  // No usable origin: there is nothing safe to echo, but the caller still has
  // to be able to read why it was refused.
  if (!origin) return withReadableRejection(response);
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set(
    "Access-Control-Expose-Headers",
    EXPOSED_HEADERS.join(", "),
  );
  response.headers.delete("Access-Control-Allow-Credentials");
  appendVary(response.headers, "Origin");
  if (options?.preflight) {
    applyPreflightHeaders(response, options.allowedMethods ?? []);
  }
  return response;
}

function applyPreflightHeaders(
  response: Response,
  allowedMethods: readonly string[],
): Response {
  response.headers.set(
    "Access-Control-Allow-Methods",
    allowedMethods.join(", "),
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    ALLOWED_HEADERS.join(", "),
  );
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
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
