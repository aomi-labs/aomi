import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { GitHubAppInstallationsResult } from "@aomi-labs/deploy";

vi.mock("@build/features/launch/hooks/use-github-app", () => ({
  useGitHubAppInstallations: vi.fn(),
}));
vi.mock("@build/features/launch/use-platform", () => ({
  usePlatform: vi.fn(),
}));

import { useGitHubAppInstallations } from "@build/features/launch/hooks/use-github-app";
import { usePlatform } from "@build/features/launch/use-platform";
import { SettingsGitHubAppPanel } from "./settings-github-app-panel";

const useGitHubAppMock = vi.mocked(useGitHubAppInstallations);
const usePlatformMock = vi.mocked(usePlatform);
const settingsUrl =
  "https://github.com/organizations/aomi-labs/settings/installations/139189936";

function report(): GitHubAppInstallationsResult {
  return {
    platform: {
      githubRepo: "aomi-labs/community-apps",
      required: { actions: "write", contents: "write" },
      installation: {
        settingsUrl,
        missingPermissions: [],
      },
      status: "ok",
    },
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
    usePlatformMock.mockReset();
    usePlatformMock.mockReturnValue("community");
  });

  it("shows only the selected platform repository", () => {
    const refetch = ready(report());
    render(<SettingsGitHubAppPanel />);

    expect(useGitHubAppMock).toHaveBeenCalledWith("community");
    expect(screen.getByText("aomi-labs/community-apps")).toBeTruthy();
    expect(screen.getByText("Access OK")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Review on GitHub/ }),
    ).toHaveAttribute("href", settingsUrl);
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows the exact missing deploy permission", () => {
    const value = report();
    value.platform!.status = "missing_permissions";
    value.platform!.installation!.missingPermissions = [
      { permission: "actions", required: "write", granted: "read" },
    ];
    ready(value);
    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText("Permissions missing")).toBeTruthy();
    expect(screen.getByText("actions: read → write")).toBeTruthy();
  });

  it("does not claim success when no platform is selected", () => {
    ready({ platform: null });
    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText(/Select a deployment platform/)).toBeTruthy();
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
