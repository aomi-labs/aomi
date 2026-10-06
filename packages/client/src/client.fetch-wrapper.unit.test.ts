import { describe, expect, it, vi } from "vitest";
import { AomiClient, wrapFetchWithAccountBearer } from "../src/client";
import type { GetAccountBearer } from "../src/types";

function bearerSource(token: string | null | undefined) {
  return vi.fn(async (options?: { forceRefresh?: boolean }) => {
    void options;
    return token;
  }) as ReturnType<typeof vi.fn> & GetAccountBearer;
}

describe("wrapFetchWithAccountBearer", () => {
  it("keeps a string POST body intact and adds the bearer", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const wrapped = wrapFetchWithAccountBearer(
      fetchMock as unknown as typeof fetch,
      bearerSource("tok"),
    );

    const body = JSON.stringify({ transactions: [{ to: "0x1" }] });
    await wrapped("http://127.0.0.1:8080/api/exec/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(input).toBe("http://127.0.0.1:8080/api/exec/simulate");
    expect(init.body).toBe(body);
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("re-sends the same string body on the 401 retry with a refreshed bearer", async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const getBearer = bearerSource("tok");
    const wrapped = wrapFetchWithAccountBearer(
      fetchMock as unknown as typeof fetch,
      getBearer,
    );

    const body = '{"a":1}';
    const response = await wrapped("http://127.0.0.1:8080/api/exec/simulate", {
      method: "POST",
      body,
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).body).toBe(body);
    }
    expect(getBearer.mock.calls.map((c) => c[0])).toEqual([
      { forceRefresh: false },
      { forceRefresh: true },
    ]);
  });

  it("clones Request inputs so the body survives the first send and the retry", async () => {
    const seenBodies: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      seenBodies.push(await (input as Request).text());
      return seenBodies.length === 1
        ? new Response("", { status: 401 })
        : new Response("{}", { status: 200 });
    });
    const wrapped = wrapFetchWithAccountBearer(
      fetchMock as unknown as typeof fetch,
      bearerSource("tok"),
    );

    const request = new Request("http://127.0.0.1:8080/api/exec/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"message":"hi"}',
    });
    const response = await wrapped(request);

    expect(response.status).toBe(200);
    expect(seenBodies).toEqual(['{"message":"hi"}', '{"message":"hi"}']);
    // The caller's Request must stay usable — the wrapper only sends clones.
    expect(request.bodyUsed).toBe(false);
    const [, init] = fetchMock.mock.calls[0] as [Request, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("never falls back to an account bearer for a public API resource", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const getBearer = bearerSource("account-token");
    const wrapped = wrapFetchWithAccountBearer(
      fetchMock as unknown as typeof fetch,
      getBearer,
    );

    await wrapped("https://chat.aomi.dev/v1/pipeline/mcp", {
      method: "POST",
    });

    expect(getBearer).not.toHaveBeenCalled();
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("uses the Agent guest identity for its durable Commit requests", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({}),
    );
    const guest = Object.assign(
      vi.fn(async () => "guest-session"),
      {
        clear: vi.fn(),
      },
    );
    const account = bearerSource("different-account");
    const client = new AomiClient({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchMock as typeof fetch,
      guest,
      getAccountBearer: account,
    });

    await client.requestResponse("GET", "/v1/agent/chat/thread-1");
    await client.requestResponse("GET", "/api/commits/commit-1", {
      sessionId: "thread-1",
    });
    await client.requestResponse("POST", "/api/commits/commit-1/manual", {
      sessionId: "thread-1",
      body: { kind: "rejected" },
    });

    expect(account).not.toHaveBeenCalled();
    expect(guest).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("authorization")).toBe(
        "Bearer guest-session",
      );
    }
  });

  it("does not fall back to a guest when a required session expires", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    const guest = Object.assign(
      vi.fn(async () => "guest-session"),
      {
        clear: vi.fn(),
      },
    );
    const account = vi.fn(async () => {
      throw new Error("session expired");
    }) as ReturnType<typeof vi.fn> & GetAccountBearer;
    account.required = true;
    const client = new AomiClient({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchMock as typeof fetch,
      guest,
      getAccountBearer: account,
    });

    await expect(
      client.requestResponse("GET", "/api/commits/commit-1"),
    ).rejects.toThrow("session expired");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(guest).not.toHaveBeenCalled();
  });

  it("does not send an anonymous request when a required session is absent", async () => {
    const fetchMock = vi.fn(async () => Response.json({}));
    const account = bearerSource(null);
    account.required = true;
    const client = new AomiClient({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchMock as typeof fetch,
      getAccountBearer: account,
      guest: true,
    });

    await expect(client.agent.sessions.list()).rejects.toThrow(
      "Required account session is unavailable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a required widget session to Agent and Pipeline APIs", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ sessions: [], nextCursor: null }),
    );
    const getBearer = bearerSource("widget-session");
    getBearer.required = true;
    const guest = vi.fn(async () => "guest-session");
    const client = new AomiClient({
      baseUrl: "https://chat.aomi.dev",
      fetch: fetchMock as unknown as typeof fetch,
      getAccountBearer: getBearer,
      guest,
    });

    await client.agent.sessions.list();
    await client.requestResponse("GET", "/v1/pipeline/catalog");

    expect(getBearer).toHaveBeenCalledTimes(2);
    expect(guest).not.toHaveBeenCalled();
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("authorization")).toBe(
        "Bearer widget-session",
      );
    }
  });

  it("simulateBatch delivers its JSON body through the wrapped fetch", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: {
              batch_success: true,
              stateful: true,
              from: "0x1",
              network: "1",
              steps: [],
            },
          }),
          { status: 200 },
        ),
    );
    const client = new AomiClient({
      baseUrl: "http://127.0.0.1:8080",
      fetch: fetchMock as unknown as typeof fetch,
      getAccountBearer: bearerSource("tok"),
    });

    await client.simulateBatch(
      "session-1",
      [{ to: "0x1111111111111111111111111111111111111111", value: "1" }],
      { chainId: 1 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(typeof init.body).toBe("string");
    const payload = JSON.parse(String(init.body)) as {
      transactions: Array<{ to: string }>;
      chain_id?: number;
    };
    expect(payload.chain_id).toBe(1);
    expect(payload.transactions).toHaveLength(1);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });
});
