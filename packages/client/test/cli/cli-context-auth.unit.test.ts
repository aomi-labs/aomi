import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/cli/cli-session", () => ({
  CliSession: { load: () => null },
}));

import { createControlClient } from "../../src/cli/context";

describe("CLI explicit API bearer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("authorizes public Pipeline requests with an anonymous bearer", async () => {
    vi.stubGlobal("location", undefined);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/auth/sign-in/anonymous") {
          return Response.json({ token: "guest-session" });
        }
        if (path === "/v1/pipeline/apps") {
          if (
            new Headers(init?.headers).get("authorization") !==
            "Bearer guest-session"
          ) {
            return Response.json(
              { error: { code: "invalid_token" } },
              { status: 401 },
            );
          }
          return Response.json({
            kind: "directory",
            path: "/v1/pipeline/apps",
            entries: [],
          });
        }
        return new Response(null, { status: 404 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createControlClient({
      baseUrl: "https://api.example",
      secrets: {},
    });
    await client.pipeline.apps.list();

    expect(
      fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname),
    ).toEqual(["/api/auth/sign-in/anonymous", "/v1/pipeline/apps"]);
  });

  it("authorizes public Pipeline requests with the explicit scoped bearer", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer scoped-api-bearer",
        );
        return Response.json({
          kind: "directory",
          path: "/v1/pipeline/apps",
          entries: [],
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = createControlClient({
      baseUrl: "https://api.example",
      accountBearer: "scoped-api-bearer",
      secrets: {},
    });
    await client.pipeline.apps.list();

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
