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
    return Response.json({ error: "invalid_widget_origin" }, { status: 403 });
  }
  return applyWidgetCors(request, new Response(null, { status: 204 }), {
    allowedMethods,
    preflight: true,
  });
}

export function applyWidgetCors(
  request: Request,
  response: Response,
  options?: { allowedMethods?: readonly string[]; preflight?: boolean },
): Response {
  const origin = observedWidgetOrigin(request);
  if (!origin) return response;
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
