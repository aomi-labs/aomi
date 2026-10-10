import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const replace = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test-navigation-link")).TestNavigationLink,
  useRouter: () => ({
    navigate: ({ href }: { href: string }) => replace(href),
  }),
}));
vi.mock("@/features/deploy/hooks/use-projects", () => ({
  useProjects: vi.fn(() => ({
    state: {
      status: "ready",
      projects: [
        {
          id: 3,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "somm.finance",
          apps: [],
          latestDeployment: null,
        },
      ],
      sdk: {
        ok: true,
        serverTags: [],
        sdkStatus: { requiredVersion: "3.0.1", status: "unknown" },
      },
      github: { signedIn: true, githubLogin: "alice", githubUserId: "u" },
    },
    reload: vi.fn(),
  })),
}));

vi.mock("./repository-connector", () => ({
  ConnectionResultBanner: ({ platform }: { platform: string }) => (
    <div>Connection result for {platform}</div>
  ),
}));

import { useProjects } from "@/features/deploy/hooks/use-projects";
import { ProjectIndex } from "./project-index";

describe("ProjectIndex", () => {
  it("continues a successful import on the same project setup page", async () => {
    render(
      <ProjectIndex
        platform="somm.finance"
        connectionResult={{ status: "success", repo: "alice/bot" }}
      />,
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "/projects/3?tab=deployments&platform=somm.finance",
      ),
    );
  });
  it("lists projects with links", async () => {
    render(<ProjectIndex platform="somm.finance" />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /alice\/bot/ })).toHaveAttribute(
        "href",
        "/projects/3?platform=somm.finance",
      ),
    );
    expect(useProjects).toHaveBeenCalledWith("somm.finance");
    expect(screen.getByRole("link", { name: "New app" })).toHaveAttribute(
      "href",
      "/operate/deployments/new?platform=somm.finance",
    );
    expect(
      screen.getByText("Connection result for somm.finance"),
    ).toBeVisible();
  });
});
