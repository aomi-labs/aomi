import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("../db/pool", () => ({
  getPool: () => ({ query }),
}));

import {
  hashOAuthClientId,
  oauthRedirectFailureDiagnostics,
} from "./oauth-redirect-diagnostics";

describe("OAuth redirect failure diagnostics", () => {
  beforeEach(() => query.mockReset());

  it("reports only safe shape and component comparisons", async () => {
    query.mockResolvedValue({
      rows: [
        {
          redirect_uris: ["http://127.0.0.1:4100/callback?source=codex"],
        },
      ],
    });

    const result = await oauthRedirectFailureDiagnostics(
      "private-client-id",
      "http://127.0.0.1:5100/callback?source=codex",
    );

    expect(result).toEqual({
      clientIdHash: hashOAuthClientId("private-client-id"),
      clientFound: true,
      registeredRedirectCount: 1,
      registeredStorageShape: "json_array",
      requestedUrlValid: true,
      credentialsAbsent: true,
      fragmentAbsent: true,
      exactMatch: false,
      loopbackMatch: true,
      protocolMatch: true,
      hostnameMatch: true,
      portMatch: false,
      pathMatch: true,
      queryMatch: true,
    });
    expect(JSON.stringify(result)).not.toContain("private-client-id");
    expect(JSON.stringify(result)).not.toContain("callback");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("client_id = $1"),
      ["private-client-id"],
    );
  });

  it("marks credentials and fragments unsafe without exposing them", async () => {
    query.mockResolvedValue({
      rows: [{ redirect_uris: '["http://127.0.0.1:4100/callback"]' }],
    });

    const result = await oauthRedirectFailureDiagnostics(
      "client",
      "http://user@127.0.0.1:5100/callback#secret",
    );

    expect(result.registeredStorageShape).toBe("json_encoded_array");
    expect(result.credentialsAbsent).toBe(false);
    expect(result.fragmentAbsent).toBe(false);
    expect(result.loopbackMatch).toBe(false);
    expect(JSON.stringify(result)).not.toContain("user");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it.each([
    ["empty userinfo", "http://@127.0.0.1:5100/callback", false, true],
    ["empty fragment", "http://127.0.0.1:5100/callback#", true, false],
  ])(
    "detects raw %s delimiters",
    async (_name, requested, credentialsAbsent, fragmentAbsent) => {
      query.mockResolvedValue({
        rows: [{ redirect_uris: ["http://127.0.0.1:4100/callback"] }],
      });

      const result = await oauthRedirectFailureDiagnostics("client", requested);

      expect(result.credentialsAbsent).toBe(credentialsAbsent);
      expect(result.fragmentAbsent).toBe(fragmentAbsent);
      expect(result.loopbackMatch).toBe(false);
    },
  );

  it("distinguishes an absent query from an empty query delimiter", async () => {
    query.mockResolvedValue({
      rows: [{ redirect_uris: ["http://127.0.0.1:4100/callback"] }],
    });

    const result = await oauthRedirectFailureDiagnostics(
      "client",
      "http://127.0.0.1:5100/callback?",
    );

    expect(result.queryMatch).toBe(false);
    expect(result.loopbackMatch).toBe(false);
  });

  it("reports one coherent component vector for multiple redirects", async () => {
    query.mockResolvedValue({
      rows: [
        {
          redirect_uris: [
            "http://127.0.0.1:4100/other?source=codex",
            "https://example.com:5100/callback?source=other",
          ],
        },
      ],
    });

    const result = await oauthRedirectFailureDiagnostics(
      "client",
      "http://127.0.0.1:5100/callback?source=codex",
    );

    expect(result).toMatchObject({
      protocolMatch: true,
      hostnameMatch: true,
      portMatch: false,
      pathMatch: false,
      queryMatch: true,
    });
  });

  it("distinguishes a missing client from malformed storage", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ redirect_uris: { unexpected: true } }],
    });

    await expect(
      oauthRedirectFailureDiagnostics("missing", "not a url"),
    ).resolves.toMatchObject({
      clientFound: false,
      registeredStorageShape: "missing",
      requestedUrlValid: false,
    });
    await expect(
      oauthRedirectFailureDiagnostics("malformed", "http://127.0.0.1/cb"),
    ).resolves.toMatchObject({
      clientFound: true,
      registeredStorageShape: "invalid",
      registeredRedirectCount: 0,
    });
  });
});
