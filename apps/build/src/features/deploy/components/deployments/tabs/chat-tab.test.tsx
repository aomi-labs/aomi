import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTab } from "./chat-tab";
import type { useProjectDetail } from "@build/features/launch/hooks/use-project-detail";

describe("ChatTab", () => {
  it("blocks chat when the live deployment SDK is outdated", () => {
    const detail = {
      source: {
        id: 42,
        repositoryLink: "alice/bot",
        sdkVersion: "3.0.2",
        apps: [
          {
            id: 77,
            name: "my-bot",
            isActive: true,
            loaded: true,
            appReleaseTag: "tag-old",
          },
        ],
      },
      sdk: { sdkStatus: { requiredVersion: "3.0.3" } },
    } as unknown as ReturnType<typeof useProjectDetail>;

    render(<ChatTab detail={detail} />);

    expect(screen.getByText("SDK upgrade required")).toBeInTheDocument();
    expect(screen.queryByTitle(/chat with/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Upgrade deployment" }),
    ).toHaveAttribute("href", "?tab=deployments");
  });

  it("blocks chat when a partial live summary includes an incompatible SDK", () => {
    const detail = {
      source: {
        id: 1,
        repositoryLink: "a/b",
        platformName: "community",
        installationId: 5,
        sdkVersion: null,
        sdkVersions: ["5.0.0"],
        apps: [
          {
            id: 17,
            name: "my-bot",
            isActive: true,
            appReleaseTag: "release-2",
            loaded: true,
          },
        ],
      },
      sdk: { sdkStatus: { requiredVersion: "5.1.0" } },
    } as unknown as ReturnType<typeof useProjectDetail>;
    const { container } = render(<ChatTab detail={detail} />);
    expect(screen.getByText("SDK upgrade required")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Upgrade deployment" }),
    ).toHaveAttribute("href", "?tab=deployments");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
