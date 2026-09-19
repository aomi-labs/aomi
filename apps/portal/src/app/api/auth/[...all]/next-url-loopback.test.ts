import { describe, expect, it } from "vitest";

import { NextURL } from "next/dist/server/web/next-url";

describe("Next OAuth callback request parsing", () => {
  it.each(["127.0.0.1", "127.25.50.75"])(
    "preserves nested IPv4 loopback host %s",
    (hostname) => {
      const callback = `http://${hostname}:43100/callback`;
      const request = new NextURL(
        "https://portal.example/api/auth/oauth2/authorize?" +
          new URLSearchParams({ redirect_uri: callback }),
      );

      expect(request.searchParams.get("redirect_uri")).toBe(callback);
    },
  );

  it.each(["127.0.0.1", "[::1]"])(
    "still normalizes outer loopback host %s",
    (hostname) => {
      const request = new NextURL(`http://${hostname}:3000/device-auth`);

      expect(request.hostname).toBe("localhost");
    },
  );

  it("normalizes a loopback base without changing a relative path", () => {
    const request = new NextURL("/device-auth", "http://127.0.0.1:3000");

    expect(request.hostname).toBe("localhost");
    expect(request.pathname).toBe("/device-auth");
  });
});
