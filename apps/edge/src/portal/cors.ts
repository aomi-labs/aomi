import { observedOrigin } from "./csrf";

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

function appendVary(response: Response, value: string): void {
  const vary = new Set(
    (response.headers.get("vary") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  vary.add(value);
  response.headers.set("Vary", [...vary].join(", "));
}

function allowOrigin(response: Response, origin: string): Response {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Expose-Headers", EXPOSED_HEADERS.join(", "));
  response.headers.delete("Access-Control-Allow-Credentials");
  appendVary(response, "Origin");
  return response;
}

function allowAnyOrigin(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.delete("Access-Control-Allow-Credentials");
  return response;
}

/** A response whose headers can be edited (upstream responses are immutable). */
function mutable(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

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
    "X-Aomi-Run-Budget-Microusd",
    "X-Aomi-CSRF",
    "X-Request-Id",
    "X-Session-Id",
    "X-Thread-Id",
  ],

  apply(request: Request, response: Response): Response {
    const origin = observedOrigin(request);
    const editable = mutable(response);
    // With no usable origin there is nothing to echo, but the caller must still
    // be able to read why it was refused; these responses carry no credentials.
    if (!origin) return allowAnyOrigin(editable);
    return allowOrigin(editable, origin);
  },

  preflight(request: Request, methods: readonly string[]): Response {
    const response = openWidget.apply(request, new Response(null, { status: 204 }));
    response.headers.set("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
    response.headers.set("Access-Control-Allow-Headers", openWidget.allowedHeaders.join(", "));
    response.headers.set("Access-Control-Max-Age", "600");
    return response;
  },
};

/** Public policy: credential-free documents anyone may read (catalogs, discovery). */
export const publicRead = {
  apply(response: Response, methods: readonly string[] = ["GET", "HEAD"]): Response {
    const editable = mutable(response);
    editable.headers.set("Access-Control-Allow-Origin", "*");
    editable.headers.set("Access-Control-Allow-Methods", [...methods, "OPTIONS"].join(", "));
    editable.headers.delete("Access-Control-Allow-Credentials");
    return editable;
  },
};
