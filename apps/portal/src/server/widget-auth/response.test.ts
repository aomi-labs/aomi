import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const telemetry = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("@portal/server/bff/failures", () => {
  return {
    portalFailures: {
      handle: (input: { response: { status: number; error: string } }) => {
        telemetry.capture(input);
        return {
          response: Response.json(
            { error: input.response.error },
            { status: input.response.status },
          ),
        };
      },
    },
  };
});

import { PortalPrincipalError } from "./principal";
import { widgetRoute } from "./response";

function widgetRequest(): Request {
  return new Request("http://localhost:3002/api/auth/widget/exchange", {
    method: "POST",
    headers: { Origin: "http://localhost:3000" },
  });
}

async function bodyOf(response: Response): Promise<unknown> {
  return response.clone().json();
}

function throwingRoute(error: unknown) {
  return widgetRoute(async () => {
    throw error;
  }, "widget.test");
}

describe("widgetRoute error handling", () => {
  beforeEach(() => {
    telemetry.capture.mockReset();
  });

  it("passes typed auth error code and status through the central handler", async () => {
    const response = await throwingRoute(
      new PortalPrincipalError("unknown_provider", 400),
    )(widgetRequest());
    expect(response.status).toBe(400);
    expect(telemetry.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "expected",
        response: { status: 400, error: "unknown_provider" },
      }),
    );
    await expect(bodyOf(response)).resolves.toEqual({
      error: "unknown_provider",
    });
  });

  it("maps ZodError to 400 invalid_request", async () => {
    const error = z.object({ a: z.string() }).safeParse({}).error;
    const response = await throwingRoute(error)(widgetRequest());
    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toEqual({ error: "invalid_request" });
    expect(telemetry.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "expected",
        response: { status: 400, error: "invalid_request" },
      }),
    );
  });

  it("maps provider-token verification failures to 401 with the code", async () => {
    for (const code of [
      "provider_token_expired",
      "provider_token_kid_mismatch",
      "invalid_provider_token_header",
      "invalid_provider_token",
    ]) {
      const response = await throwingRoute(new Error(code))(widgetRequest());
      expect(response.status).toBe(401);
      expect(await bodyOf(response)).toEqual({ error: code });
    }
    expect(telemetry.capture).toHaveBeenCalledTimes(4);
  });

  it("keeps genuinely unknown errors as 500 widget_auth_failed", async () => {
    const failure = new Error("Para JWKS verification is not configured");
    const response = await throwingRoute(failure)(widgetRequest());
    expect(response.status).toBe(500);
    expect(await bodyOf(response)).toEqual({ error: "widget_auth_failed" });
    expect(telemetry.capture).toHaveBeenCalledTimes(1);
    expect(telemetry.capture).toHaveBeenCalledWith({
      source: "local",
      error: failure,
      response: { status: 500, error: "widget_auth_failed" },
      context: {
        routeFamily: "/api/auth/widget/exchange",
        operation: "widget.test",
        method: "POST",
      },
    });
  });

  it("applies cross-origin CORS headers to the error response", async () => {
    const response = await throwingRoute(
      new PortalPrincipalError("invalid_request", 400),
    )(widgetRequest());
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
    expect(response.headers.get("Vary")).toContain("Origin");
  });
});

describe("widgetRoute", () => {
  it("applies CORS to a successful handler response", async () => {
    const handler = widgetRoute(
      async () => Response.json({ ok: true }),
      "widget.test_success",
    );
    const response = await handler(widgetRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
  });

  it("maps thrown typed errors centrally", async () => {
    const handler = widgetRoute(async () => {
      throw new PortalPrincipalError("provider_not_enabled", 400);
    }, "widget.test_typed_error");
    const response = await handler(widgetRequest());
    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toEqual({ error: "provider_not_enabled" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:3000",
    );
  });
});
