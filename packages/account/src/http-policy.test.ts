// @vitest-environment node
import { describe, expect, it } from "vitest";
import { trailingSlashRedirect } from "./http-policy";

describe("trailingSlashRedirect", () => {
  it.each([
    "/",
    "/?next=/projects/&value=a%2Bb",
    "/openapi.json?next=/projects/",
    "/projects/item%2Fpart",
  ])("leaves canonical URL %s unchanged", (path) => {
    expect(
      trailingSlashRedirect(new Request(`http://localhost${path}`)),
    ).toBeNull();
  });

  it.each([
    ["/settings/", "/settings"],
    ["/openapi.json/", "/openapi.json"],
    [
      "/.well-known/oauth-protected-resource/",
      "/.well-known/oauth-protected-resource",
    ],
    ["/projects/item%2Fpart%5Ctail/", "/projects/item%2Fpart%5Ctail"],
    [
      "/api/test/?a=a%2Bb&next=%2Fpath%2F&a=two",
      "/api/test?a=a%2Bb&next=%2Fpath%2F&a=two",
    ],
  ])("redirects %s permanently to %s", async (path, location) => {
    const response = trailingSlashRedirect(
      new Request(`http://localhost${path}`),
    );
    expect(response?.status).toBe(308);
    expect(response?.headers.get("Location")).toBe(location);
    expect(response?.headers.get("Refresh")).toBe(`0;url=${location}`);
    expect(response?.headers.has("Content-Type")).toBe(false);
    expect(await response?.text()).toBe(location);
  });

  it.each(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])(
    "uses a method-preserving 308 for %s",
    (method) => {
      const response = trailingSlashRedirect(
        new Request("http://localhost/api/test/?value=a%2Bb", { method }),
      );
      expect(response?.status).toBe(308);
      expect(response?.headers.get("Location")).toBe("/api/test?value=a%2Bb");
    },
  );

  it("does not consume a POST body before redirecting", async () => {
    const request = new Request("http://localhost/api/test/", {
      method: "POST",
      body: "controlled request body",
    });
    expect(trailingSlashRedirect(request)?.status).toBe(308);
    expect(request.bodyUsed).toBe(false);
    expect(await request.text()).toBe("controlled request body");
  });

  it.each([
    ["//outside.example/", "/outside.example/"],
    [
      "/api//test///?next=https://outside.example/",
      "/api/test/?next=https://outside.example/",
    ],
    ["//", "/"],
    ["/projects//item", "/projects/item"],
  ])(
    "normalizes repeated slashes in %s before removing a trailing slash",
    (path, location) => {
      const response = trailingSlashRedirect(
        new Request(`http://localhost${path}`),
      );
      expect(response?.status).toBe(308);
      expect(response?.headers.get("Location")).toBe(location);
      expect(new URL(location, "http://localhost").origin).toBe(
        "http://localhost",
      );
    },
  );
});
