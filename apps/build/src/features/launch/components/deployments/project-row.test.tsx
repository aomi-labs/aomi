import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectRow } from "./project-row";

describe("ProjectRow", () => {
  it("links to the project page and shows the repo", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "community",
          apps: [],
          latestDeployment: null,
        }}
        requiredSdk="3.0.1"
      />,
    );
    const link = screen.getByRole("link", { name: /alice\/bot/ });
    expect(link).toHaveAttribute("href", "/projects/42?platform=community");
  });

  it("shows deployment status instead of a live app count", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "community",
          apps: [
            {
              name: "my-bot",
              isActive: false,
              loaded: false,
              appReleaseTag: "tag-old",
            },
          ],
          latestDeployment: {
            state: "recorded",
            sdkVersion: "3.0.1",
            apps: [],
            createdAt: 1,
          },
        }}
        requiredSdk="3.0.1"
      />,
    );

    expect(screen.getByText("Deactivated")).toBeInTheDocument();
    expect(screen.getByText("my-bot")).toBeInTheDocument();
    expect(screen.queryByText(/live app/i)).not.toBeInTheDocument();
  });

  it("shows Live deployment when the source is live", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "community",
          apps: [
            {
              name: "playground-example",
              isActive: true,
              loaded: true,
              appReleaseTag: "tag-1",
            },
          ],
          latestDeployment: null,
        }}
      />,
    );

    expect(screen.getByText("Live deployment")).toBeInTheDocument();
    expect(screen.getByText("playground-example")).toBeInTheDocument();
  });

  it("links an outdated project to its upgrade flow", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "somm.finance",
          sdkVersion: "3.0.2",
          apps: [
            {
              name: "my-bot",
              isActive: true,
              loaded: false,
              appReleaseTag: "tag-old",
            },
          ],
          latestDeployment: null,
        }}
        requiredSdk="3.0.3"
      />,
    );

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      "/projects/42?platform=somm.finance&tab=deployments",
    );
  });

  it("shows an upgrade when any live app has an outdated SDK", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "community",
          sdkVersions: ["3.0.3", "3.0.4"],
          apps: [],
          latestDeployment: null,
        }}
        requiredSdk="3.0.4"
      />,
    );
    expect(screen.getByTestId("sdk-badge")).toHaveTextContent("SDK mixed");
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      "/projects/42?platform=community&tab=deployments",
    );
  });
});
