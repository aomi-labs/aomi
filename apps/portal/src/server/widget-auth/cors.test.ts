import { describe, expect, it } from "vitest";
import { widgetCorsPreflight } from "./cors";

describe("widgetCorsPreflight", () => {
  it("allows the SSE resume header used by cross-origin thread updates", () => {
    const response = widgetCorsPreflight(
      new Request("http://localhost:3002/api/thread/updates", {
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
});
