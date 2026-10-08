import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_SESSION_EXPIRED, buildFetch } from "./session-expiry";

afterEach(() => vi.unstubAllGlobals());

describe("Build session expiry", () => {
  it("announces an unauthorized response without consuming or replacing it", async () => {
    const response = Response.json(
      { error: "Not signed in with GitHub" },
      { status: 401 },
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const expired = vi.fn();
    window.addEventListener(BUILD_SESSION_EXPIRED, expired);
    try {
      expect(await buildFetch("/api/bff/launch/projects")).toBe(response);
      expect(expired).toHaveBeenCalledTimes(1);
      expect(await response.json()).toEqual({
        error: "Not signed in with GitHub",
      });
    } finally {
      window.removeEventListener(BUILD_SESSION_EXPIRED, expired);
    }
  });
  it("does not describe a forbidden operation as session expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );
    const expired = vi.fn();
    window.addEventListener(BUILD_SESSION_EXPIRED, expired);
    try {
      await buildFetch("/api/bff/launch/projects");
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(BUILD_SESSION_EXPIRED, expired);
    }
  });
});
