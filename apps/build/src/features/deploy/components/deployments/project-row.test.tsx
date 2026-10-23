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

  // Index rows never run the runtime probe, so they say Activated even when
  // the Manager's own flag claims loaded.
  it("shows Activated for a live source without a runtime probe", () => {
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

    expect(screen.getByText("Activated")).toBeInTheDocument();
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

  it("marks a live app the runtime cannot load as incompatible, in red", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "community",
          sdkVersion: "4.0.0",
          sdkVersions: ["4.0.0"],
          ffiVersion: null,
          ffiVersions: [],
          requiredFfiVersion: 1,
          ffiUnrecorded: true,
          ffiIncompatible: true,
          ffiUnverifiedSdkVersions: ["4.0.0"],
          apps: [
            {
              id: 7,
              name: "my-bot",
              label: null,
              platform: "community",
              projectId: 42,
              isActive: true,
              isPublic: true,
              loaded: true,
              appReleaseTag: "tag-old",
              targetTags: [],
            },
          ],
          latestDeployment: null,
        }}
        requiredSdk="6.0.0"
      />,
    );

    expect(screen.getByText("Incompatible")).toBeInTheDocument();
    expect(screen.queryByText("Outdated")).not.toBeInTheDocument();
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      "incompatible",
    );
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      "/projects/42?platform=community&tab=deployments",
    );
  });

  it("keeps the amber upgrade for SDK drift the runtime still loads", () => {
    render(
      <ProjectRow
        source={{
          id: 42,
          installationId: 1,
          repositoryLink: "alice/bot",
          platformName: "community",
          sdkVersion: "5.1.1",
          sdkVersions: ["5.1.1"],
          ffiVersion: 1,
          ffiVersions: [1],
          requiredFfiVersion: 1,
          ffiUnrecorded: false,
          apps: [
            {
              id: 7,
              name: "my-bot",
              label: null,
              platform: "community",
              projectId: 42,
              isActive: true,
              isPublic: true,
              loaded: true,
              appReleaseTag: "tag-old",
              targetTags: [],
            },
          ],
          latestDeployment: null,
        }}
        requiredSdk="6.0.0"
      />,
    );

    expect(screen.getByText("Outdated")).toBeInTheDocument();
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      "outdated",
    );
    expect(screen.getByRole("link", { name: "Upgrade" })).toBeInTheDocument();
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
