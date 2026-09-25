import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const githubAppInstallUrl = vi.hoisted(() => vi.fn());

vi.mock("@build/features/launch/client", () => ({ githubAppInstallUrl }));

import {
  ConnectionResultBanner,
  RepositoryConnector,
} from "./repository-connector";

describe("ConnectionResultBanner", () => {
  it("renders nothing without a result", () => {
    const { container } = render(
      <ConnectionResultBanner platform="somm.finance" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the connected repository and platform on success", () => {
    render(
      <ConnectionResultBanner
        platform="somm.finance"
        result={{ status: "success", repo: "PeggyJV/somm-agent" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "PeggyJV/somm-agent is now connected to somm.finance.",
    );
  });

  it("reports progress as a status, not a failure", () => {
    render(
      <ConnectionResultBanner
        platform="somm.finance"
        result={{ status: "pending", message: "Install requested." }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Install requested.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports a failure as an alert", () => {
    render(
      <ConnectionResultBanner
        platform="somm.finance"
        result={{ status: "error", message: "Could not connect." }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not connect.");
  });
});

describe("RepositoryConnector", () => {
  beforeEach(() => {
    githubAppInstallUrl.mockResolvedValue(
      "https://github.com/apps/aomi-build/installations/new",
    );
  });

  it("starts a repo-specific install and returns to the scoped project page", async () => {
    const navigate = vi.fn();
    render(<RepositoryConnector platform="somm.finance" navigate={navigate} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "GitHub repository" }),
      {
        target: { value: "PeggyJV/somm-agent" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect repository" }));

    await waitFor(() =>
      expect(githubAppInstallUrl).toHaveBeenCalledWith({
        platform: "somm.finance",
        repo: "PeggyJV/somm-agent",
        returnTo: "http://localhost:3000/projects?platform=somm.finance",
      }),
    );
    expect(navigate).toHaveBeenCalledWith(
      "https://github.com/apps/aomi-build/installations/new",
    );
    expect(screen.getByRole("button", { name: "Connecting…" })).toBeDisabled();
  });

  it("restores Connect repository when the GitHub hand-off cannot start", async () => {
    githubAppInstallUrl.mockRejectedValueOnce(new Error("GitHub unavailable"));
    render(<RepositoryConnector platform="somm.finance" navigate={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "GitHub repository" }),
      { target: { value: "PeggyJV/somm-agent" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect repository" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "GitHub unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Connect repository" }),
    ).toBeEnabled();
  });

  it("explains invalid repository input without opening GitHub", () => {
    render(<RepositoryConnector platform="somm.finance" navigate={vi.fn()} />);
    fireEvent.change(
      screen.getByRole("textbox", { name: "GitHub repository" }),
      {
        target: { value: "not-a-repository" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect repository" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a GitHub repository as owner/name.",
    );
    expect(githubAppInstallUrl).not.toHaveBeenCalled();
  });
});
