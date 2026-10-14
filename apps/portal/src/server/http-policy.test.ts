// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  legacyDeploymentRedirect,
  protectBootstrapResponse,
} from "./http-policy";

afterEach(() => vi.unstubAllEnvs());

describe("legacy deployment redirects", () => {
  it.each([
    [undefined, "https://build.aomi.dev"],
    ["https://build-staging.aomi.dev/", "https://build-staging.aomi.dev"],
    ["http://localhost:3001", "http://localhost:3001"],
  ])(
    "uses Build origin %s and preserves the query string",
    (configured, origin) => {
      vi.stubEnv("AOMI_BUILD_URL", configured);
      for (const [source, destination] of [
        ["/deployments/new", "/operate/deployments/new"],
        ["/deployments/project-1", "/projects/project-1"],
        ["/deployments", "/projects"],
      ]) {
        const response = legacyDeploymentRedirect(
          new Request(`https://chat.aomi.dev${source}?tab=logs`),
        );
        expect(response?.status).toBe(307);
        expect(response?.headers.get("location")).toBe(
          `${origin}${destination}?tab=logs`,
        );
      }
      expect(
        legacyDeploymentRedirect(
          new Request("https://chat.aomi.dev/deployments-other"),
        ),
      ).toBeNull();
    },
  );
});

it("protects bootstrap responses without buffering or losing cookies", () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
      },
    }),
    {
      status: 201,
      headers: [
        ["Set-Cookie", "session=one; HttpOnly"],
        ["Set-Cookie", "identity=two; Secure"],
      ],
    },
  );
  const protectedResponse = protectBootstrapResponse(
    new Request("https://chat.aomi.dev/oauth/bootstrap"),
    response,
  );
  expect(protectedResponse.body).toBe(response.body);
  expect(protectedResponse.status).toBe(201);
  expect(protectedResponse.headers.getSetCookie()).toEqual(
    response.headers.getSetCookie(),
  );
  expect(protectedResponse.headers.get("cache-control")).toBe("no-store");
  expect(protectedResponse.headers.get("referrer-policy")).toBe("no-referrer");
  expect(protectedResponse.headers.get("content-security-policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(
    protectBootstrapResponse(new Request("https://chat.aomi.dev/"), response),
  ).toBe(response);
});
