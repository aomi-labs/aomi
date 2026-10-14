import { describe, expect, it } from "vitest";

describe("Native OAuth callback request parsing", () => {
  it.each(["127.0.0.1", "127.25.50.75"])(
    "preserves nested IPv4 loopback host %s",
    (hostname) => {
      const callback = `http://${hostname}:43100/callback`;
      const request = new URL(
        "https://portal.example/api/auth/oauth2/authorize?" +
          new URLSearchParams({ redirect_uri: callback }),
      );

      expect(request.searchParams.get("redirect_uri")).toBe(callback);
    },
  );

  it.each(["127.0.0.1", "[::1]"])(
    "preserves outer loopback host %s",
    (hostname) => {
      const request = new URL(`http://${hostname}:3000/device-auth`);

      expect(request.hostname).toBe(hostname);
    },
  );

  it("preserves a loopback base and relative path", () => {
    const request = new URL("/device-auth", "http://127.0.0.1:3000");

    expect(request.hostname).toBe("127.0.0.1");
    expect(request.pathname).toBe("/device-auth");
  });
});
