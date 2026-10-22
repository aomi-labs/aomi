import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTab } from "./chat-tab";
import type { useProjectDetail } from "@/features/deploy/hooks/use-project-detail";

describe("ChatTab", () => {
  const liveApp = {
    id: 77,
    name: "my-bot",
    isActive: true,
    isPublic: true,
    loaded: true,
    appReleaseTag: "tag-1",
  };

  it("keeps chat open on SDK drift when the backend loads the app's FFI", () => {
    const detail = {
      source: {
        id: 42,
        repositoryLink: "alice/bot",
        platformName: "community",
        installationId: 1,
        sdkVersion: "5.1.1",
        sdkVersions: ["5.1.1"],
        ffiVersion: 1,
        ffiVersions: [1],
        requiredFfiVersion: 1,
        ffiUnrecorded: false,
        apps: [liveApp],
      },
      sdk: { sdkStatus: { requiredVersion: "6.0.0" } },
    } as unknown as ReturnType<typeof useProjectDetail>;

    const { container } = render(<ChatTab detail={detail} />);

    expect(screen.queryByTestId("chat-gate")).not.toBeInTheDocument();
    expect(screen.queryByText("SDK upgrade required")).not.toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(screen.getByRole("link", { name: /open chat/i })).toBeInTheDocument();
  });

  it("blocks chat in red when the runtime cannot load the app's FFI", () => {
    const detail = {
      source: {
        id: 42,
        repositoryLink: "alice/bot",
        platformName: "community",
        installationId: 1,
        sdkVersion: "4.0.0",
        sdkVersions: ["4.0.0"],
        ffiVersion: null,
        ffiVersions: [],
        requiredFfiVersion: 1,
        ffiUnrecorded: true,
        ffiIncompatible: true,
        ffiUnverifiedSdkVersions: ["4.0.0"],
        apps: [liveApp],
      },
      sdk: { sdkStatus: { requiredVersion: "6.0.0" } },
    } as unknown as ReturnType<typeof useProjectDetail>;

    const { container } = render(<ChatTab detail={detail} />);

    expect(screen.getByTestId("chat-gate")).toHaveAttribute(
      "data-severity",
      "error",
    );
    expect(
      screen.getByText("App cannot run on this backend"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This deployment cannot chat: its build has no FFI contract this backend can load. Rebuild it with a supported SDK (5.1.1 or newer) and redeploy.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/aomi-sdk 6\.0\.0/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Upgrade deployment" }),
    ).toHaveAttribute("href", "?tab=deployments");
    expect(container.querySelector("iframe")).toBeNull();
  });

  // An older backend reports no FFI and refuses mismatched SDKs, so the old
  // amber gate stays.
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

    expect(screen.getByTestId("chat-gate")).toHaveAttribute(
      "data-severity",
      "warning",
    );
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
