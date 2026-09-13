import { describe, expect, it } from "vitest";
import { widgetCorsPreflight } from "./cors";

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
});
