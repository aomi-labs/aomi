import { beforeEach, describe, expect, it, vi } from "vitest";
import { AomiClient } from "../src/client";
import type { AomiOAuthTokenRequest } from "../src/authorization";

describe("AomiClient per-user app credentials", () => {
  const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();

  beforeEach(() => {
    fetchMock.mockReset();
  });

  function client() {
    return new AomiClient({
      baseUrl: "https://api.example",
      fetch: fetchMock,
    });
  }

  it("lists configuration status without expecting secret values", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        application_id: 42,
        app: "venue",
        ready: false,
        missing_required: ["VENUE_KEY"],
        slots: [
          {
            name: "VENUE_KEY",
            description: "Personal API key",
            required: true,
            user_own: true,
            configured: false,
            app_provided: false,
          },
        ],
      }),
    );

    const result = await client().listAppSecrets("thread-1", 42);

    expect(result.ready).toBe(false);
    expect(result.missing_required).toEqual(["VENUE_KEY"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example/api/account/apps/42/secrets",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
  });

  it("sends only the caller-provided slot map when saving", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        application_id: 42,
        app: "venue",
        ready: true,
        missing_required: [],
        slots: [],
      }),
    );

    await client().saveAppSecrets("thread-1", 42, {
      VENUE_KEY: "secret-value",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example/api/account/apps/42/secrets");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ secrets: { VENUE_KEY: "secret-value" } }),
    );
  });

  it("encodes application and slot identifiers for removal", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ deleted: true }))
      .mockResolvedValueOnce(Response.json({ cleared: true, removed: 1 }));

    await client().deleteAppSecret("thread-1", "venue/id", "KEY/name");
    await client().clearAppSecrets("thread-1", "venue/id");

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, init?.method]),
    ).toEqual([
      [
        "https://api.example/api/account/apps/venue%2Fid/secrets/KEY%2Fname",
        "DELETE",
      ],
      ["https://api.example/api/account/apps/venue%2Fid/secrets", "DELETE"],
    ]);
  });

  it("rejects an empty application identifier before making a request", async () => {
    await expect(client().listAppSecrets("thread-1", "")).rejects.toThrow(
      "applicationId is required",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists, installs, and removes account apps without exposing array replacement", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json([
          {
            name: "venue",
            application_id: 42,
            is_installed: true,
            secrets: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        Response.json({
          application_id: 42,
          app: "venue",
          installed: true,
          apps: ["default", "venue"],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          application_id: 42,
          app: "venue",
          installed: false,
          apps: ["default"],
        }),
      );

    const api = client();
    await expect(api.listAccountApps("thread-1")).resolves.toMatchObject([
      { name: "venue", applicationId: 42, isInstalled: true },
    ]);
    await expect(api.addAccountApp("thread-1", 42)).resolves.toMatchObject({
      application_id: 42,
      installed: true,
    });
    await expect(api.removeAccountApp("thread-1", 42)).resolves.toMatchObject({
      application_id: 42,
      installed: false,
    });

    expect(
      fetchMock.mock.calls.slice(1).map(([url, init]) => [url, init?.method]),
    ).toEqual([
      ["https://api.example/api/account/apps/42", "POST"],
      ["https://api.example/api/account/apps/42", "DELETE"],
    ]);
  });

  it("provides single-credential status, set, replace, and remove helpers", async () => {
    const status = {
      application_id: 42,
      app: "venue",
      ready: true,
      missing_required: [],
      slots: [],
    };
    fetchMock
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json({ deleted: true }));

    const api = client();
    await api.getAppCredentialsStatus("thread-1", 42);
    await api.setAppCredential("thread-1", 42, "VENUE_KEY", "first");
    await api.replaceAppCredential("thread-1", 42, "VENUE_KEY", "second");
    await api.removeAppCredential("thread-1", 42, "VENUE_KEY");

    expect(
      fetchMock.mock.calls.map(([url, init]) => [
        url,
        init?.method ?? "GET",
        init?.body,
      ]),
    ).toEqual([
      ["https://api.example/api/account/apps/42/secrets", "GET", undefined],
      [
        "https://api.example/api/account/apps/42/secrets",
        "POST",
        JSON.stringify({ secrets: { VENUE_KEY: "first" } }),
      ],
      [
        "https://api.example/api/account/apps/42/secrets",
        "POST",
        JSON.stringify({ secrets: { VENUE_KEY: "second" } }),
      ],
      [
        "https://api.example/api/account/apps/42/secrets/VENUE_KEY",
        "DELETE",
        undefined,
      ],
    ]);
  });
  it("uses the account OAuth resource and distinct scopes for apps and credentials", async () => {
    const oauth = vi.fn(
      async ({ resource, scopes }: AomiOAuthTokenRequest) => ({
        resource,
        scopes,
        accessToken: "account-access",
        expiresAt: Date.now() + 60_000,
      }),
    );
    fetchMock.mockImplementation(async (url) =>
      Response.json(String(url).endsWith("/apps") ? [] : {}),
    );
    const api = new AomiClient({
      baseUrl: "https://api.example",
      fetch: fetchMock,
      oauth,
    });
    await api.listAccountApps("s");
    await api.addAccountApp("s", 42);
    await api.getAppCredentialsStatus("s", 42);
    await api.setAppCredential("s", 42, "API_KEY", "test-value");
    await api.removeAppCredential("s", 42, "API_KEY");
    await api.removeAccountApp("s", 42);
    expect(oauth.mock.calls.map(([request]) => request.scopes)).toEqual([
      ["account:apps:read"],
      ["account:apps:write"],
      ["account:credentials:read"],
      ["account:credentials:write"],
      ["account:credentials:write"],
      ["account:apps:write"],
    ]);
    expect(
      oauth.mock.calls.every(
        ([request]) => request.resource === "https://api.example/v1/account",
      ),
    ).toBe(true);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api.example\/v1\/account\/apps/);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer account-access",
      );
    }
  });
});
