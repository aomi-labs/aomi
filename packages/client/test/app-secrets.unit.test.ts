import { beforeEach, describe, expect, it, vi } from "vitest";
import { AomiClient } from "../src/client";

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
            secrets: [],
          },
        ]),
      )
      .mockResolvedValueOnce(Response.json({ user: { apps: ["default"] } }))
      .mockResolvedValueOnce(Response.json({ apps: ["default", "venue"] }))
      .mockResolvedValueOnce(
        Response.json({ user: { apps: ["default", "venue"] } }),
      )
      .mockResolvedValueOnce(Response.json({ apps: ["default"] }));

    const api = client();
    await expect(api.listAccountApps("thread-1")).resolves.toMatchObject([
      { name: "venue", applicationId: 42 },
    ]);
    await expect(api.addAccountApp("thread-1", "venue")).resolves.toEqual({
      apps: ["default", "venue"],
    });
    await expect(api.removeAccountApp("thread-1", "venue")).resolves.toEqual({
      apps: ["default"],
    });

    const writes = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    expect(writes.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { apps: ["default", "venue"] },
      { apps: ["default"] },
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
});
