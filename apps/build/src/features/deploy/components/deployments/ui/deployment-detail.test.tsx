import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { UserProject, UserProjectLatestDeployment } from "@aomi-labs/deploy";
import { DeploymentDetail } from "./deployment-detail";
import type { TimelineDeployment } from "../deployment-timeline";

const deployment: TimelineDeployment = {
  deploymentId: "dep_142228159_rb87f6980b6_0f88b7504e07",
  commit: "0f88b7504e07",
  apps: ["playground-example"],
  releaseTags: ["apps-142228159-rb87f6980b6-playground-example-0f88b7504e07"],
  current: true,
  actor: "aomi-build-recovery",
  sdkVersion: "3.0.2",
  createdAt: 1784062014,
};

const source = {
  id: 1586,
  repositoryLink: "ceciliaz030/playground-6",
  platformName: "community",
  apps: [],
} as unknown as UserProject;

const entry = {
  deploymentId: "dep_142228159_rb87f6980b6_0f88b7504e07",
  state: "ready",
  platformBranch: "ceciliaz030/playground-6/142228159/0f88b7504e07",
  platformRepo: "aomi-labs/community-apps",
  commitHash: "b1879438b457226422d50a5bf3eaa64f64c2cb72",
  ciStatus: "passed",
  ciUrl: "https://github.com/aomi-labs/community-apps/actions/runs/1",
  releaseTags: ["apps-142228159-rb87f6980b6-playground-example-0f88b7504e07"],
  apps: [
    {
      name: "playground-example",
      releaseTag: "apps-142228159-rb87f6980b6-playground-example-0f88b7504e07",
      target: "x86_64-unknown-linux-gnu",
      artifactReady: true,
    },
  ],
} as unknown as UserProjectLatestDeployment;

function renderDetail(
  overrides: Partial<React.ComponentProps<typeof DeploymentDetail>> = {},
) {
  return render(
    <DeploymentDetail
      deployment={deployment}
      source={source}
      requiredSdk="3.0.3"
      entry={entry}
      platformRepo="aomi-labs/community-apps"
      historyPending={false}
      expanded
      onToggle={vi.fn()}
      {...overrides}
    />,
  );
}

describe("DeploymentDetail", () => {
  it("names every field for the builder and links it to GitHub", () => {
    renderDetail();

    expect(screen.getByText("Source repository")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /ceciliaz030\/playground-6$/i }),
    ).toHaveAttribute("href", "https://github.com/ceciliaz030/playground-6");

    // The project feed preserves the immutable short source commit.
    expect(screen.getByRole("link", { name: "0f88b7504e07" })).toHaveAttribute(
      "href",
      "https://github.com/ceciliaz030/playground-6/commit/0f88b7504e07",
    );

    // Outdated SDK carries the required-version pill.
    expect(screen.getByText("3.0.2")).toBeInTheDocument();
    expect(screen.getByText("requires 3.0.3")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "community" })).toHaveAttribute(
      "href",
      "https://github.com/aomi-labs/community-apps",
    );
    expect(
      screen.getByRole("link", {
        name: "ceciliaz030/playground-6/142228159/0f88b7504e07",
      }),
    ).toHaveAttribute(
      "href",
      "https://github.com/aomi-labs/community-apps/tree/ceciliaz030/playground-6/142228159/0f88b7504e07",
    );
  });

  it("lists apps with release tag, target, and release asset links", () => {
    renderDetail();

    const tag = "apps-142228159-rb87f6980b6-playground-example-0f88b7504e07";
    expect(screen.getByRole("link", { name: tag })).toHaveAttribute(
      "href",
      `https://github.com/aomi-labs/community-apps/releases/tag/${tag}`,
    );
    expect(screen.getByText("x86_64-unknown-linux-gnu")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "manifest.json" })).toHaveAttribute(
      "href",
      `https://github.com/aomi-labs/community-apps/releases/download/${tag}/manifest.json`,
    );
    expect(
      screen.getByRole("link", { name: "aomi-release.json" }),
    ).toHaveAttribute(
      "href",
      `https://github.com/aomi-labs/community-apps/releases/download/${tag}/aomi-release.json`,
    );
    // Candidate commit CI actually built, distinct from the source commit.
    expect(screen.getByRole("link", { name: "b1879438b457" })).toHaveAttribute(
      "href",
      "https://github.com/aomi-labs/community-apps/commit/b1879438b457226422d50a5bf3eaa64f64c2cb72",
    );
  });

  it("shows pending build artifacts with the CI link while building", () => {
    renderDetail({
      deployment: { ...deployment, current: false },
      entry: {
        ...entry,
        state: "building",
        apps: entry.apps.map((app) => ({ ...app, artifactReady: false })),
      } as UserProjectLatestDeployment,
    });

    expect(screen.getByText(/waiting on platform ci/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view ci run/i })).toHaveAttribute(
      "href",
      "https://github.com/aomi-labs/community-apps/actions/runs/1",
    );
  });

  it("collapses to just the toggle bar", () => {
    const onToggle = vi.fn();
    renderDetail({ expanded: false, onToggle });
    expect(screen.queryByText("Source repository")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /deployment detail/i }),
    );
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
