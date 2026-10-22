import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SdkBadge } from "./sdk-badge";
import { projectSdk } from "../sdk-compatibility";

describe("SdkBadge", () => {
  it.each([
    ["ok", "3.0.1"],
    ["outdated", "3.0.0"],
    ["missing", null],
  ] as const)("shows %s for stamp %s", (state, stamped) => {
    render(<SdkBadge stamped={stamped} required="3.0.1" />);
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      state,
    );
  });
  it("shows incompatible, not outdated, for a release the runtime refuses", () => {
    const sdk = projectSdk(
      {
        id: 1,
        installationId: 1,
        repositoryLink: "alice/bot",
        platformName: "community",
        sdkVersion: "4.0.0",
        requiredFfiVersion: 1,
        ffiUnrecorded: true,
        ffiIncompatible: true,
        ffiUnverifiedSdkVersions: ["4.0.0"],
        apps: [],
        latestDeployment: null,
      },
      "6.0.0",
    );
    render(<SdkBadge sdk={sdk} />);
    const badge = screen.getByTestId("sdk-badge");
    expect(badge).toHaveAttribute("data-state", "incompatible");
    expect(badge).toHaveTextContent("4.0.0");
  });
  it("renders a project's shared SDK story", () => {
    const sdk = projectSdk(
      {
        id: 1,
        installationId: 1,
        repositoryLink: "alice/bot",
        platformName: "community",
        sdkVersion: "5.0.0",
        apps: [],
        latestDeployment: null,
      },
      "5.1.0",
    );
    render(<SdkBadge sdk={sdk} />);
    const badge = screen.getByTestId("sdk-badge");
    expect(badge).toHaveAttribute("data-state", "outdated");
    expect(badge).toHaveTextContent("5.0.0");
  });
});
