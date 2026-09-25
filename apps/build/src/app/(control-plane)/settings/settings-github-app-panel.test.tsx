import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { GitHubAppInstallationsResult } from "@aomi-labs/deploy";

vi.mock("@build/features/launch/hooks/use-github-app", () => ({
  useGitHubAppInstallations: vi.fn(),
}));
vi.mock("@build/features/launch/client", () => ({
  githubAppInstallUrl: vi.fn(),
  githubSigninUrl: "/api/auth/github",
}));

import { useGitHubAppInstallations } from "@build/features/launch/hooks/use-github-app";
import { SettingsGitHubAppPanel } from "./settings-github-app-panel";

const useGitHubAppMock = vi.mocked(useGitHubAppInstallations);
const settingsUrl = "https://github.com/settings/installations/139189936";

function report(): GitHubAppInstallationsResult {
  return {
    status: "ok",
    repositories: [
      {
        projectId: 7,
        githubRepo: "builder/repo-x",
        platform: "community",
        settingsUrl,
        status: "ok",
      },
    ],
  };
}

function ready(value: GitHubAppInstallationsResult, refetch = vi.fn()) {
  useGitHubAppMock.mockReturnValue({
    state: { status: "ready", report: value },
    refetch,
    refetching: false,
  });
  return refetch;
}

describe("SettingsGitHubAppPanel", () => {
  beforeEach(() => {
    useGitHubAppMock.mockReset();
  });

  it("shows connected source repositories and never platform infrastructure", () => {
    const refetch = ready(report());
    render(<SettingsGitHubAppPanel />);

    expect(useGitHubAppMock).toHaveBeenCalledWith();
    expect(screen.getByText("builder/repo-x")).toBeTruthy();
    expect(screen.queryByText("aomi-labs/community-apps")).toBeNull();
    expect(screen.getByText("Access OK")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Manage/ })).toHaveAttribute(
      "href",
      settingsUrl,
    );
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the source permission action without exposing internal repos", () => {
    const value = report();
    value.status = "action_required";
    value.repositories[0].status = "missing_permissions";
    ready(value);
    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText("Permissions missing")).toBeTruthy();
    expect(screen.getByText(/Contents: read/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Review access/ })).toHaveAttribute(
      "href",
      settingsUrl,
    );
  });

  it("explains when there are no connected repositories", () => {
    ready({ status: "ok", repositories: [] });
    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText(/No repositories are connected yet/)).toBeTruthy();
    expect(screen.queryByText("Access OK")).toBeNull();
  });

  it("asks for GitHub sign-in before reading anything", () => {
    useGitHubAppMock.mockReturnValue({
      state: { status: "signed_out" },
      refetch: vi.fn(),
      refetching: false,
    });
    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText("Sign in with GitHub")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Re-check/ })).toBeNull();
  });
});
