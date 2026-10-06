import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiClient, wrapFetchWithPublicApiAuthorization } from "./client";
import { AgentApiError } from "./agent/transport";
import {
  createGuestSessionProvider,
  withBrowserSessionTransition,
} from "./guest-auth";

afterEach(() => vi.unstubAllGlobals());
const origin = "https://chat.aomi.dev";
const session = (anonymous = false) => ({
  session: { id: "existing" },
  user: { id: "user-existing", isAnonymous: anonymous },
});

describe("interactive guest preparation", () => {
  it("refuses to resend a chat request under a renewed guest", async () => {
    vi.stubGlobal("location", { origin: "https://vendor.example" });
    let subject = 0;
    let expired = false;
    const posts: string[] = [];
    const fetch = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/widget/guest"))
          return Response.json({
            access_token: `aomi_wst_${++subject}`,
            user: { id: `guest-${subject}` },
          });
        const token = new Headers(init?.headers).get("authorization")!;
        posts.push(token);
        return new Response(null, { status: expired ? 401 : 200 });
      },
    );
    const guest = createGuestSessionProvider({ baseUrl: origin, fetch });
    const authorized = wrapFetchWithPublicApiAuthorization({
      baseUrl: origin,
      fetch,
      guest,
    });
    const options = { method: "POST", headers: { "x-session-id": "old-chat" } };
    await authorized(`${origin}/v1/agent/chat`, options);
    expired = true;
    await expect(
      authorized(`${origin}/v1/agent/chat`, options),
    ).rejects.toMatchObject({
      name: "AgentApiError",
      code: "guest_identity_changed",
      status: 401,
      retryable: false,
    });
    expect(posts).toEqual(["Bearer aomi_wst_1", "Bearer aomi_wst_1"]);
    expect(guest.getIdentity?.()).toBe("guest-2");
    expired = false;
    await authorized(`${origin}/v1/agent/chat`, {
      method: "POST",
      headers: { "x-session-id": "fresh-chat" },
    });
    expect(posts).toEqual([
      "Bearer aomi_wst_1",
      "Bearer aomi_wst_1",
      "Bearer aomi_wst_2",
    ]);
    expect(subject).toBe(2);
  });

  it.each([401, 403])(
    "does not rotate a guest for an App refusal (%s)",
    async (status) => {
      vi.stubGlobal("location", { origin: "https://vendor.example" });
      let acquisitions = 0;
      const fetch = vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("/widget/guest")) {
          acquisitions++;
          return Response.json({
            access_token: "aomi_wst_guest",
            user: { id: "guest" },
          });
        }
        return Response.json(
          { error: { code: "app_key_not_scoped" } },
          { status },
        );
      });
      const guest = createGuestSessionProvider({ baseUrl: origin, fetch });
      const authorized = wrapFetchWithPublicApiAuthorization({
        baseUrl: origin,
        fetch,
        guest,
      });
      expect(
        (
          await authorized(`${origin}/v1/agent/chat`, {
            method: "POST",
            headers: { "x-session-id": "chat" },
          })
        ).status,
      ).toBe(status);
      expect(acquisitions).toBe(1);
    },
  );
  it("stays passive on load, coalesces interaction, and makes immediate Send join the pending cookie", async () => {
    vi.stubGlobal("location", { origin });
    let finish!: (response: Response) => void;
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/get-session")) return Response.json(null);
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const guest = createGuestSessionProvider({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
    });
    await guest();
    expect(fetch).not.toHaveBeenCalled();
    const first = guest.prepare!();
    const second = guest.prepare!();
    const upstream = vi.fn(async () => new Response(null, { status: 200 }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      baseUrl: origin,
      fetch: upstream as typeof globalThis.fetch,
      guest,
    });
    const send = authorized(`${origin}/v1/agent/chat`, { method: "POST" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(upstream).not.toHaveBeenCalled();
    finish(Response.json({}));
    await Promise.all([first, second, send]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toBe(
      `${origin}/api/auth/get-session`,
    );
    expect(String(fetch.mock.calls[1][0])).toBe(
      `${origin}/api/auth/sign-in/anonymous`,
    );
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "preserves an existing signed/anonymous session (anonymous=%s)",
    async (anonymous) => {
      vi.stubGlobal("location", { origin });
      const fetch = vi.fn(async () => Response.json(session(anonymous)));
      const guest = createGuestSessionProvider({
        baseUrl: origin,
        fetch: fetch as typeof globalThis.fetch,
      });
      await guest.prepare!();
      await guest.prepare!();
      await expect(guest()).resolves.toBeNull();
      expect(guest.getIdentity?.()).toBe(anonymous ? "user-existing" : null);
      expect(fetch).toHaveBeenCalledOnce();
      expect(String(fetch.mock.calls[0][0])).toBe(
        `${origin}/api/auth/get-session`,
      );
    },
  );

  it("prepares before a direct Send and admits the first Agent request without a 401", async () => {
    vi.stubGlobal("location", { origin });
    const paths: string[] = [];
    let cookieReady = false;
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith("get-session")) return Response.json(null);
      if (path.endsWith("sign-in/anonymous")) {
        cookieReady = true;
        return Response.json({});
      }
      return new Response(null, { status: cookieReady ? 200 : 401 });
    });
    const client = new AomiClient({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await client.requestResponse("POST", "/v1/agent/chat", {
          body: { message: "immediate" },
        })
      ).status,
    ).toBe(200);
    expect(paths).toEqual([
      "/api/auth/get-session",
      "/api/auth/sign-in/anonymous",
      "/v1/agent/chat",
    ]);
  });

  it("reuses a confirmed same-origin cookie while a 401 still forces the live session guard", async () => {
    vi.stubGlobal("location", { origin });
    const fetch = vi.fn(async () =>
      Response.json({ code: "session_exists" }, { status: 409 }),
    );
    const hint = vi.fn(() => true);
    const guest = createGuestSessionProvider({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
      getCookieSessionAvailable: hint,
    });
    await guest.prepare!();
    expect(fetch).not.toHaveBeenCalled();
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const authorized = wrapFetchWithPublicApiAuthorization({
      baseUrl: origin,
      fetch: upstream as typeof globalThis.fetch,
      guest,
    });
    expect(
      (await authorized(`${origin}/v1/agent/chat`, { method: "POST" })).status,
    ).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe(
      `${origin}/api/auth/sign-in/anonymous`,
    );
  });

  it("does not replace a session when the existing-session check fails", async () => {
    vi.stubGlobal("location", { origin });
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    const client = new AomiClient({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(client.prepareGuestSession()).rejects.toThrow(
      "session check failed with HTTP 503",
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe(
      `${origin}/api/auth/get-session`,
    );
  });

  it("checks the session once per short window while the check keeps failing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { origin });
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    const client = new AomiClient({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
    });
    for (let keystroke = 0; keystroke < 5; keystroke++)
      await expect(client.prepareGuestSession()).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(client.prepareGuestSession()).rejects.toThrow("HTTP 503");
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("uses the origin-bound bearer lane for a cross-origin embed without reading cookies", async () => {
    vi.stubGlobal("location", { origin: "https://vendor.example" });
    const fetch = vi.fn(
      async (url: string | URL | Request, options?: RequestInit) => {
        if (String(url).endsWith("/widget/guest")) {
          expect(options?.credentials).toBe("omit");
          return Response.json({ access_token: "aomi_wst_interactive" });
        }
        expect(new Headers(options?.headers).get("authorization")).toBe(
          "Bearer aomi_wst_interactive",
        );
        return new Response(null, { status: 200 });
      },
    );
    const guest = createGuestSessionProvider({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
      getCookieSessionAvailable: () => true,
    });
    const client = new AomiClient({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
      guest,
    });
    await Promise.all([
      client.prepareGuestSession(),
      client.prepareGuestSession(),
    ]);
    await client.requestResponse("POST", "/v1/agent/chat", {
      body: { message: "embed" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toBe(
      `${origin}/api/auth/widget/guest`,
    );
  });

  it("checks the resulting signed-in cookie after an in-flight wallet session transition", async () => {
    vi.stubGlobal("location", { origin });
    let finishWallet!: () => void;
    const wallet = withBrowserSessionTransition(
      () =>
        new Promise<void>((resolve) => {
          finishWallet = resolve;
        }),
    );
    await Promise.resolve();
    const fetch = vi.fn(async () => Response.json(session()));
    const guest = createGuestSessionProvider({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
    });
    const preparation = guest.prepare!();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    finishWallet();
    await Promise.all([wallet, preparation]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe(
      `${origin}/api/auth/get-session`,
    );
  });

  it("leaves explicitly configured account authentication in control", async () => {
    vi.stubGlobal("location", { origin });
    const fetch = vi.fn();
    const client = new AomiClient({
      baseUrl: origin,
      fetch: fetch as typeof globalThis.fetch,
      getAccountBearer: vi.fn(async () => "signed"),
    });
    await client.prepareGuestSession();
    expect(fetch).not.toHaveBeenCalled();
  });
});
