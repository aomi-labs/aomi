import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { githubAppInstallUrl, launchSignOutGitHub } from "./client";

describe("githubAppInstallUrl", () => {
  const fetch = vi.fn();
  beforeEach(() => {
    fetch.mockResolvedValue(
      Response.json({
        ok: true,
        install_url: "https://github.com/apps/aomi-build/installations/new",
      }),
    );
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("signs a repo-specific platform and Build return page into OAuth start", async () => {
    await expect(
      githubAppInstallUrl({
        platform: "somm.finance",
        repo: "PeggyJV/somm-agent",
        returnTo: "https://build.aomi.dev/projects?platform=somm.finance",
      }),
    ).resolves.toContain("github.com/apps/aomi-build");

    const [path] = fetch.mock.calls[0] as [string];
    const url = new URL(path, "https://build.aomi.dev");
    expect(url.searchParams.get("platform")).toBe("somm.finance");
    expect(url.searchParams.get("repo")).toBe("PeggyJV/somm-agent");
    expect(url.searchParams.get("return_to")).toBe(
      "https://build.aomi.dev/projects?platform=somm.finance",
    );
  });
});

describe("GitHub sign-out state isolation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it.each([false, true])(
    "clears wizard state when request fails: %s",
    async (fails) => {
      localStorage.setItem(
        "aomi_launch",
        JSON.stringify({
          platform: "community",
          oneshot: { repo: "old/account" },
        }),
      );
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      if (fails) fetch.mockRejectedValue(new Error("offline"));
      else fetch.mockResolvedValue(new Response(null, { status: 204 }));

      const result = launchSignOutGitHub();
      if (fails) await expect(result).rejects.toThrow("offline");
      else await result;

      expect(fetch).toHaveBeenCalledWith("/api/build/auth/github/signout", {
        method: "POST",
      });
      expect(localStorage.getItem("aomi_launch")).toBeNull();
    },
  );
});
