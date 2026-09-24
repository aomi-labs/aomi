import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

const report = {
  platform: null,
};

vi.mock("@build/features/launch/client", () => ({
  deploymentGitHubAppInstallations: vi.fn(async () => report),
}));
vi.mock("@build/features/launch/dashboard", () => ({
  fetchGitHubSession: vi.fn(async () => ({
    signedIn: true,
    githubLogin: "alice",
    githubUserId: "u1",
  })),
}));

import { GitHubSessionProvider } from "@build/components/control-plane/github-session-context";
import { useGitHubAppInstallations } from "./use-github-app";
import { deploymentGitHubAppInstallations } from "@build/features/launch/client";
import { fetchGitHubSession } from "@build/features/launch/dashboard";

const list = vi.mocked(deploymentGitHubAppInstallations);
const session = vi.mocked(fetchGitHubSession);

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

describe("useGitHubAppInstallations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the report off the shared session for the selected platform", async () => {
    const { result } = renderHook(
      () => useGitHubAppInstallations("community"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(session).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith("community");
    if (result.current.state.status === "ready") {
      expect(result.current.state.report).toEqual(report);
    }
  });

  it("stays signed out without asking the BFF", async () => {
    session.mockResolvedValueOnce({ signedIn: false, githubLogin: null });
    const { result } = renderHook(() => useGitHubAppInstallations(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.state.status).toBe("signed_out"));
    expect(list).not.toHaveBeenCalled();
  });

  it("surfaces a failed read as an error state and re-checks on demand", async () => {
    list.mockRejectedValueOnce(new Error("manager down"));
    const { result } = renderHook(() => useGitHubAppInstallations(), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.error).toBe("manager down");
    }
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(list).toHaveBeenCalledTimes(2);
  });
});
