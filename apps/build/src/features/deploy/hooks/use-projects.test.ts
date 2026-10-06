import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

vi.mock("@build/features/launch/client", () => ({
  deploymentProjects: vi.fn(async () => ({
    projects: [
      {
        id: 1,
        installationId: 5,
        repositoryLink: "a/b",
        apps: [{ name: "bot" }],
        latestDeployment: null,
      },
      {
        id: 2,
        installationId: 5,
        repositoryLink: "a/historical-repo",
        apps: [],
        latestDeployment: null,
      },
    ],
  })),
  deploymentSdkStatus: vi.fn(async () => ({
    ok: true,
    serverTags: [],
    sdkStatus: { requiredVersion: "3.0.1", status: "unknown" },
  })),
  deploymentFeed: vi.fn(),
}));
vi.mock("@build/features/launch/dashboard", () => ({
  fetchGitHubSession: vi.fn(async () => ({
    signedIn: true,
    githubLogin: "alice",
    githubUserId: "u1",
  })),
}));

import { GitHubSessionProvider } from "@build/components/control-plane/github-session-context";
import { useProjects } from "./use-projects";
import {
  deploymentFeed,
  deploymentProjects,
} from "@build/features/launch/client";
import { fetchGitHubSession } from "@build/features/launch/dashboard";

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client },
      createElement(GitHubSessionProvider, null, children),
    );
  };
}

describe("useProjects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads app projects off the shared session, empty projects included", async () => {
    const { result } = renderHook(() => useProjects(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    // The session must come from the provider — exactly one status fetch,
    // not one per hook consumer.
    expect(fetchGitHubSession).toHaveBeenCalledTimes(1);
    expect(deploymentFeed).not.toHaveBeenCalled();
    if (result.current.state.status === "ready") {
      // A claimed source with no apps yet (fresh connect) is a real project.
      expect(result.current.state.projects).toHaveLength(2);
      expect(result.current.state.projects[0]?.repositoryLink).toBe("a/b");
      expect(result.current.state.projects[1]?.repositoryLink).toBe(
        "a/historical-repo",
      );
    }
  });

  it("loads projects from an exact platform when one is selected", async () => {
    const { result } = renderHook(() => useProjects("somm.finance"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(deploymentProjects).toHaveBeenCalledWith("somm.finance");
  });
});
