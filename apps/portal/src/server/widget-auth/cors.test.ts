import { describe, expect, it } from "vitest";
import { applyWidgetCors, widgetCorsPreflight } from "./cors";

describe("widgetCorsPreflight", () => {
  it("allows the SSE resume header used by cross-origin thread updates", () => {
    const response = widgetCorsPreflight(
      new Request("http://localhost:3002/v1/agent/chat/test-session/stream", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "authorization,last-event-id",
        },
      }),
      ["GET", "OPTIONS"],
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Last-Event-ID",
    );
  });

  it("lets the browser read an origin rejection", () => {
    // With no CORS header at all, a refused origin reaches the page as an
    // opaque network failure and is indistinguishable from the server being
    // down. The wildcard is safe here: this surface never sets
    // `Access-Control-Allow-Credentials`, and the body is only the error code.
    const response = widgetCorsPreflight(
      new Request("http://localhost:3002/api/thread/updates", {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Method": "GET" },
      }),
      ["GET", "OPTIONS"],
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("allows Agent and Pipeline SDK request headers and exposes response metadata", () => {
    const request = new Request("https://portal.example/v1/agent/chat", {
      method: "OPTIONS",
      headers: {
        Origin: "https://consumer.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "authorization,content-type,idempotency-key,payment-signature,x-aomi-inference-funding,dpop",
      },
    });
    const preflight = widgetCorsPreflight(request, ["POST", "OPTIONS"]);
    const allowed = preflight.headers.get("Access-Control-Allow-Headers") ?? "";

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://consumer.example",
    );
    for (const header of [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "Payment-Signature",
      "X-Aomi-Inference-Funding",
      "DPoP",
    ]) {
      expect(allowed).toContain(header);
    }
    expect(preflight.headers.has("Access-Control-Allow-Credentials")).toBe(
      false,
    );

    const actual = applyWidgetCors(
      request,
      new Response("stream", {
        headers: { "Access-Control-Allow-Credentials": "true" },
      }),
    );
    expect(actual.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://consumer.example",
    );
    expect(actual.headers.get("Access-Control-Expose-Headers")).toContain(
      "X-Request-Id",
    );
    expect(actual.headers.has("Access-Control-Allow-Credentials")).toBe(false);
  });
});
