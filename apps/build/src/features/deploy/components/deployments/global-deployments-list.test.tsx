import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("./use-global-deployment-records", () => ({
  useGlobalDeploymentRecords: vi.fn(() => ({
    projectsState: {
      status: "ready",
      projects: [
        {
          id: 42,
          repositoryLink: "alice/bot",
        },
      ],
    },
    recordsState: {
      status: "ready",
      deployments: [
        {
          projectId: 42,
          repositoryLink: "alice/bot",
          deploymentId: "dep_1_alice-bot_abc123",
          commit: "abc123",
          apps: ["bot"],
          releaseTags: ["apps-1-alice-bot-bot-abc123"],
          current: true,
          actor: "alice",
          sdkVersion: "3.0.1",
          createdAt: 1_800_000_000,
        },
      ],
    },
    projects: [{ id: 42, repositoryLink: "alice/bot" }],
    reload: vi.fn(),
    loadMore: vi.fn(),
    hasMore: false,
    loadingMore: false,
  })),
}));

import { GlobalDeploymentsList } from "./global-deployments-list";

describe("GlobalDeploymentsList", () => {
  it("renders all deployment records read-only", () => {
    render(<GlobalDeploymentsList platform="world-market-apps" />);

    expect(screen.getByText("dep_1_alice-bot_abc123")).toBeInTheDocument();
    expect(screen.getAllByText("alice/bot").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /promote/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deactivate/i })).toBeNull();
    expect(
      screen.getByRole("link", { name: /view deployment/i }),
    ).toHaveAttribute(
      "href",
      "/operate/deployments?platform=world-market-apps&project=42&deployment=dep_1_alice-bot_abc123",
    );
  });
});
