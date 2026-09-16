import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const { deploymentProjects } = vi.hoisted(() => ({
  deploymentProjects: vi.fn(),
}));

vi.mock("@build/features/launch/client", () => ({ deploymentProjects }));
vi.mock("@build/components/control-plane/github-session-context", () => ({
  useGitHubSession: () => ({
    account: { loading: false, signedIn: true, githubLogin: "alice" },
  }),
}));

import { useAccessiblePlatforms } from "./use-accessible-platforms";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function on(...platformNames: string[]) {
  return {
    projects: platformNames.map((platformName, index) => ({
      id: index + 1,
      platformName,
    })),
  };
}

async function platforms(list: unknown, active?: string) {
  deploymentProjects.mockResolvedValue(list);
  const { result } = renderHook(() => useAccessiblePlatforms(active), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(result.current.status).toBe("ready"));
  return result.current.status === "ready" ? result.current.platforms : [];
}

describe("useAccessiblePlatforms", () => {
  beforeEach(() => deploymentProjects.mockReset());

  it("reads the account-wide project list, unscoped by platform", async () => {
    await platforms(on("somm.finance"));

    expect(deploymentProjects).toHaveBeenCalledWith();
  });

  it("counts projects per distinct platform, Community first", async () => {
    expect(
      await platforms(on("somm.finance", "byreal", "somm.finance")),
    ).toEqual([
      { name: "community", projectCount: 0 },
      { name: "byreal", projectCount: 1 },
      { name: "somm.finance", projectCount: 2 },
    ]);
  });

  it("trims names and ignores projects with no platform", async () => {
    expect(
      await platforms({
        projects: [
          { id: 1, platformName: "  somm.finance  " },
          { id: 2, platformName: "" },
          { id: 3, platformName: null },
        ],
      }),
    ).toEqual([
      { name: "community", projectCount: 0 },
      { name: "somm.finance", projectCount: 1 },
    ]);
  });

  it("includes the active platform even with no projects on it", async () => {
    expect(await platforms(on(), "new.partner")).toEqual([
      { name: "community", projectCount: 0 },
      { name: "new.partner", projectCount: 0 },
    ]);
  });

  it("counts the active platform's own projects rather than resetting it", async () => {
    expect(await platforms(on("somm.finance"), "somm.finance")).toEqual([
      { name: "community", projectCount: 0 },
      { name: "somm.finance", projectCount: 1 },
    ]);
  });

  it("reports unavailable when the read fails, never an empty list", async () => {
    deploymentProjects.mockImplementation(() =>
      Promise.reject(new Error("nope")),
    );
    const { result, unmount } = renderHook(() => useAccessiblePlatforms(), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    // Teardown calls the mock once more. A rejecting implementation left in
    // place surfaces that call as an unhandled rejection rather than a query
    // error, so hand back a resolving one before the test ends.
    unmount();
    deploymentProjects.mockResolvedValue({ projects: [] });
  });
});
