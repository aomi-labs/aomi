import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@build/features/launch/hooks/use-projects", () => ({
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

import { useProjects } from "@build/features/launch/hooks/use-projects";
import { ProjectIndex } from "./project-index";

describe("ProjectIndex", () => {
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
