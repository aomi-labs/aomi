import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeployProgressBar } from "./deploy-progress-bar";

describe("DeployProgressBar", () => {
  it("renders nothing while idle", () => {
    const { container } = render(
      <DeployProgressBar deployFlow={{ phase: "idle" }} startedAt={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the CI percentage, label and run link while building", () => {
    render(
      <DeployProgressBar
        deployFlow={{
          phase: "building",
          message: "Building… (building)",
          progress: {
            percent: 30,
            label: "Building CI",
            ciUrl: "https://github.com/a/b/actions/runs/1",
          },
        }}
        startedAt={Date.now()}
      />,
    );
    const bar = screen.getByRole("progressbar", { name: "Deployment progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    expect(bar).toHaveAttribute("aria-valuetext", "Building CI");
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("Building… (building)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /CI run/i })).toHaveAttribute(
      "href",
      "https://github.com/a/b/actions/runs/1",
    );
  });

  it("still draws a track for a phase that has no progress yet", () => {
    render(
      <DeployProgressBar
        deployFlow={{ phase: "deploying", message: "Resolving latest commit…" }}
        startedAt={null}
      />,
    );
    expect(
      screen.getByRole("progressbar", { name: "Deployment progress" }),
    ).toHaveAttribute("aria-valuenow", "2");
    // No start time yet — the clock stays out of the way rather than showing 00:00.
    expect(screen.queryByLabelText("Elapsed")).not.toBeInTheDocument();
  });

  it("reports the failure message and drops the percentage on error", () => {
    render(
      <DeployProgressBar
        deployFlow={{
          phase: "error",
          message: "Deploy failed",
          progress: { percent: 100, label: "Deploy failed", ciUrl: null },
        }}
        startedAt={Date.now()}
      />,
    );
    expect(screen.getByText("Deploy failed")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Deployment progress" }),
    ).not.toHaveAttribute("aria-valuenow");
  });
});
