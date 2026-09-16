import { describe, expect, it } from "vitest";

type FetchCall = {
  url: string;
  headers: Headers;
};

function installLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    },
  });
}

describe("settingsApiFetch", () => {
  it("joins same-origin backend URLs as /api paths", async () => {
    const previousBackendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    const previousFetch = globalThis.fetch;
    process.env.NEXT_PUBLIC_BACKEND_URL = "/";
    installLocalStorage();

    const calls: FetchCall[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          headers: new Headers(init?.headers),
        });
        return Response.json({ ok: true });
      },
    });

    try {
      const { sessionScopedFetch } = await import("./settings-api");
      await sessionScopedFetch("/api/account/apps");

      expect(calls[0]?.url).toBe("/api/account/apps");
      expect(calls[0]?.headers.get("X-Thread-Id") ?? "").toMatch(
        /^(settings-|[0-9a-f-]{36})/,
      );
    } finally {
      if (previousBackendUrl === undefined) {
        delete process.env.NEXT_PUBLIC_BACKEND_URL;
      } else {
        process.env.NEXT_PUBLIC_BACKEND_URL = previousBackendUrl;
      }
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: previousFetch,
      });
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
