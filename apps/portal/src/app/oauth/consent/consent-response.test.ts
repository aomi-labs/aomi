import { describe, expect, it } from "vitest";
import { oauthConsentRedirect } from "./consent-response";

describe("OAuth consent response", () => {
  it("accepts Better Auth's canonical redirect response", () => {
    expect(
      oauthConsentRedirect({
        redirect: true,
        url: "https://partner.example/oauth/callback?code=code-1",
      }),
    ).toBe("https://partner.example/oauth/callback?code=code-1");
  });

  it("rejects legacy redirect field aliases", () => {
    expect(
      oauthConsentRedirect({ redirect_uri: "https://example.com/a" }),
    ).toBe(null);
    expect(oauthConsentRedirect({ redirectURI: "https://example.com/b" })).toBe(
      null,
    );
  });
});
