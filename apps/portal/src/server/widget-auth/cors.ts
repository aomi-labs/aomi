import { observedWidgetOrigin } from "@aomi-labs/account/widget-auth";

const ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Aomi-App-Key",
  "Last-Event-ID",
  "X-Session-Id",
  "X-Thread-Id",
];

export function widgetCorsPreflight(
  request: Request,
  allowedMethods: readonly string[],
): Response {
  if (!observedWidgetOrigin(request)) {
    return withReadableRejection(
      Response.json({ error: "invalid_widget_origin" }, { status: 403 }),
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
  appendVary(response.headers, "Origin");
  if (options?.preflight) {
    response.headers.set(
      "Access-Control-Allow-Methods",
      (options.allowedMethods ?? []).join(", "),
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      ALLOWED_HEADERS.join(", "),
    );
    response.headers.set("Access-Control-Max-Age", "600");
  }
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
