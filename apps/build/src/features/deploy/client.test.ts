import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionScopedFetch = vi.hoisted(() => vi.fn());

vi.mock("@build/lib/settings-api", () => ({ sessionScopedFetch }));

import { githubAppInstallUrl } from "./client";

describe("githubAppInstallUrl", () => {
  beforeEach(() => {
    sessionScopedFetch.mockResolvedValue({
      ok: true,
      install_url: "https://github.com/apps/aomi-build/installations/new",
    });
  });

  it("signs a repo-specific platform and Build return page into OAuth start", async () => {
    await expect(
      githubAppInstallUrl({
        platform: "somm.finance",
        repo: "PeggyJV/somm-agent",
        returnTo: "https://build.aomi.dev/projects?platform=somm.finance",
      }),
    ).resolves.toContain("github.com/apps/aomi-build");

    const [path] = sessionScopedFetch.mock.calls[0] as [string];
    const url = new URL(path, "https://build.aomi.dev");
    expect(url.searchParams.get("platform")).toBe("somm.finance");
    expect(url.searchParams.get("repo")).toBe("PeggyJV/somm-agent");
    expect(url.searchParams.get("return_to")).toBe(
      "https://build.aomi.dev/projects?platform=somm.finance",
    );
  });
});
