import { describe, expect, it, vi, beforeEach } from "vitest";
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

const SETTINGS_URL =
  "https://github.com/organizations/aomi-labs/settings/installations/139189936";

function report(
  overrides: Partial<GitHubAppInstallationsResult> = {},
): GitHubAppInstallationsResult {
  return {
    apps: [
      {
        appId: 1001,
        slug: "aomi-build",
        declaredPermissions: { actions: "write", contents: "write" },
      },
    ],
    installations: [
      {
        installationId: 7,
        appId: 1001,
        appSlug: "aomi-build",
        account: { login: "alice", type: "User" },
        repositorySelection: "selected",
        suspended: false,
        settingsUrl: "https://github.com/settings/installations/7",
        grantedPermissions: { actions: "write", contents: "write" },
        missingPermissions: [],
        repositories: ["alice/bot"],
        status: "ok",
      },
    ],
    platform: {
      name: "community",
      githubRepo: "aomi-labs/community-apps",
      required: { actions: "write", contents: "write" },
      installation: {
        installationId: 139189936,
        appId: 1001,
        appSlug: "aomi-build",
        account: { login: "aomi-labs", type: "Organization" },
        settingsUrl: SETTINGS_URL,
        grantedPermissions: { actions: "write", contents: "write" },
        missingPermissions: [],
        status: "ok",
      },
      status: "ok",
    },
    ...overrides,
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

  it("shows the App, the platform repository, and each installation as OK", () => {
    const refetch = ready(report());

    render(<SettingsGitHubAppPanel />);

    expect(useGitHubAppMock).toHaveBeenCalledWith("community");
    expect(screen.getByRole("link", { name: "aomi-build" })).toHaveAttribute(
      "href",
      "https://github.com/apps/aomi-build",
    );
    expect(screen.getByText(/aomi-labs\/community-apps/)).toBeTruthy();
    expect(screen.getByText(/^alice$/)).toBeTruthy();
    expect(screen.getByText("alice/bot")).toBeTruthy();
    expect(screen.getAllByText("Access OK")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("lists the missing permission and links to the installation settings page", () => {
    const value = report();
    value.platform!.status = "missing_permissions";
    value.platform!.installation!.status = "missing_permissions";
    value.platform!.installation!.grantedPermissions = {
      actions: "read",
      contents: "write",
    };
    value.platform!.installation!.missingPermissions = [
      { permission: "actions", required: "write", granted: "read" },
    ];
    ready(value);

    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText("actions: read → write")).toBeTruthy();
    expect(screen.getByText("Permissions missing")).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /Review on GitHub/ })[0],
    ).toHaveAttribute("href", SETTINGS_URL);
  });

  it("shows a per-installation check failure without a review link", () => {
    ready(
      report({
        installations: [
          {
            installationId: 9,
            appId: null,
            appSlug: null,
            account: { login: "", type: "" },
            repositorySelection: null,
            suspended: false,
            settingsUrl: null,
            grantedPermissions: {},
            missingPermissions: [],
            repositories: ["alice/legacy"],
            status: "error",
            error: "GitHub returned 500",
          },
        ],
        platform: null,
      }),
    );

    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText("GitHub returned 500")).toBeTruthy();
    expect(screen.getByText("Check failed")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Review on GitHub/ })).toBeNull();
  });

  it("says when the App is not installed on the platform repository", () => {
    const value = report();
    value.platform = {
      ...value.platform!,
      installation: null,
      status: "not_installed",
    };
    ready(value);

    render(<SettingsGitHubAppPanel />);

    expect(screen.getByText("Not installed")).toBeTruthy();
    expect(
      screen.getByText(/not installed on the platform repository/),
    ).toBeTruthy();
  });

  it("shows the empty state when no owned project has an installation", () => {
    ready(report({ installations: [] }));

    render(<SettingsGitHubAppPanel />);

    expect(
      screen.getByText(
        "No GitHub App installation is linked to your projects yet.",
      ),
    ).toBeTruthy();
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
