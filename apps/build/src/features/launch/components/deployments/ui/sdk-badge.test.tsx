import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SdkBadge } from "./sdk-badge";
import { projectSdk } from "../sdk-compatibility";

describe("SdkBadge", () => {
  it("shows ok when stamped matches required", () => {
    render(<SdkBadge stamped="3.0.1" required="3.0.1" />);
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute("data-state", "ok");
  });
  it("shows outdated when they differ", () => {
    render(<SdkBadge stamped="3.0.0" required="3.0.1" />);
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      "outdated",
    );
  });
  it("shows missing when stamp absent", () => {
    render(<SdkBadge stamped={null} required="3.0.1" />);
    expect(screen.getByTestId("sdk-badge")).toHaveAttribute(
      "data-state",
      "missing",
    );
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
