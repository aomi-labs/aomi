import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/features/deploy/hooks/use-projects", () => ({
  useProjects: vi.fn(),
}));
vi.mock("@/features/deploy/use-platform", () => ({
  usePlatform: vi.fn(),
}));

import { useProjects } from "@/features/deploy/hooks/use-projects";
import { usePlatform } from "@/features/deploy/use-platform";
import { SettingsSecretsPanel } from "./settings-secrets-panel";

const useProjectsMock = vi.mocked(useProjects);
const usePlatformMock = vi.mocked(usePlatform);

describe("SettingsSecretsPanel", () => {
  beforeEach(() => {
    useProjectsMock.mockReset();
    usePlatformMock.mockReset();
    usePlatformMock.mockReturnValue("community");
  });

  it("shows New app when there are no projects", () => {
    useProjectsMock.mockReturnValue({
      state: {
        status: "ready",
        projects: [],
        sdk: null,
        github: { signedIn: true, githubLogin: "alice", githubUserId: "1" },
      },
      reload: vi.fn(),
    });

    render(<SettingsSecretsPanel />);
    expect(screen.getByText(/No projects yet/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /New app/i })).toHaveAttribute(
      "href",
      "/operate/deployments/new?platform=community",
    );
  });

  /** Settings has no `?platform=` of its own, so an unscoped read here listed
   *  every project the account owns — including ones the selected platform
   *  cannot open, whose Environment tab then fails to read its secrets. */
  it("lists only the selected platform's projects", () => {
    usePlatformMock.mockReturnValue("world-market-apps");
    useProjectsMock.mockReturnValue({
      state: {
        status: "ready",
        projects: [
          {
            id: 3,
            installationId: 1,
            repositoryLink: "alice/bot",
            apps: [],
            latestDeployment: null,
          },
          {
            id: 4,
            installationId: 1,
            repositoryLink: "alice/other",
            apps: [],
            latestDeployment: null,
          },
        ],
        sdk: null,
        github: { signedIn: true, githubLogin: "alice", githubUserId: "1" },
      },
      reload: vi.fn(),
    });

    render(<SettingsSecretsPanel />);

    expect(useProjectsMock).toHaveBeenCalledWith("world-market-apps");
    // Following a row keeps the platform, so the project page and its back
    // path do not silently drop the reader onto Community.
    expect(screen.getByRole("link", { name: /alice\/bot/i })).toHaveAttribute(
      "href",
      "/projects/3?tab=environment&platform=world-market-apps",
    );
  });

  it("stays on Settings for a single project with an Environment CTA", () => {
    useProjectsMock.mockReturnValue({
      state: {
        status: "ready",
        projects: [
          {
            id: 7,
            installationId: 1,
            repositoryLink: "alice/only-bot",
            apps: [],
            latestDeployment: null,
          },
        ],
        sdk: null,
        github: { signedIn: true, githubLogin: "alice", githubUserId: "1" },
      },
      reload: vi.fn(),
    });

    render(<SettingsSecretsPanel />);

    expect(screen.getByText(/Per-project secrets/i)).toBeTruthy();
    expect(screen.getByText(/alice\/only-bot/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Open Environment/i }),
    ).toHaveAttribute("href", "/projects/7?tab=environment&platform=community");
  });

  it("lists projects that deep-link to Environment", () => {
    useProjectsMock.mockReturnValue({
      state: {
        status: "ready",
        projects: [
          {
            id: 3,
            installationId: 1,
            repositoryLink: "alice/bot",
            apps: [],
            latestDeployment: null,
          },
          {
            id: 4,
            installationId: 1,
            repositoryLink: "alice/other",
            apps: [],
            latestDeployment: null,
          },
        ],
        sdk: null,
        github: { signedIn: true, githubLogin: "alice", githubUserId: "1" },
      },
      reload: vi.fn(),
    });

    render(<SettingsSecretsPanel />);
    expect(screen.getByRole("link", { name: /alice\/bot/i })).toHaveAttribute(
      "href",
      "/projects/3?tab=environment&platform=community",
    );
    expect(screen.getByRole("link", { name: /alice\/other/i })).toHaveAttribute(
      "href",
      "/projects/4?tab=environment&platform=community",
    );
  });
});
