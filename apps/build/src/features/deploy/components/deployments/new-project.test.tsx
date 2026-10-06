import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchGitHubSession = vi.hoisted(() => vi.fn());

vi.mock("@build/features/launch/dashboard", () => ({
  fetchGitHubSession,
  GITHUB_SIGNIN_URL: "/api/github/signin",
}));

vi.mock("@build/features/launch/components/onboarding", () => ({
  Onboarding: ({ platform }: { platform?: string }) => (
    <div>Template wizard for {platform}</div>
  ),
}));

vi.mock("./repository-connector", () => ({
  RepositoryConnector: ({ platform }: { platform: string }) => (
    <div>Connect repository to {platform}</div>
  ),
}));

import { newProjectMode } from "@build/features/launch/new-project-mode";
import { saveLaunch } from "@build/features/launch";
import { NewProject } from "./new-project";

const TEMPLATE_CARD = { name: /Start from the template/ };
const IMPORT_CARD = { name: /Import from GitHub/ };

describe("NewProject", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/operate/deployments/new");
    fetchGitHubSession.mockResolvedValue({
      signedIn: true,
      githubLogin: "alice",
      installationId: "42",
    });
  });

  it("offers both starting points before either flow runs", async () => {
    render(<NewProject platform="somm.finance" />);

    await screen.findByRole("button", TEMPLATE_CARD);
    expect(screen.getByRole("button", IMPORT_CARD)).toBeVisible();
    expect(screen.queryByText(/Template wizard/)).toBeNull();
    expect(screen.queryByText(/Connect repository/)).toBeNull();
  });

  it("opens the template wizard and records the choice in the URL", async () => {
    render(<NewProject platform="somm.finance" />);

    fireEvent.click(await screen.findByRole("button", TEMPLATE_CARD));

    expect(screen.getByText("Template wizard for somm.finance")).toBeVisible();
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.get("mode")).toBe(
        "template",
      ),
    );
  });

  it("opens the repository connector and can go back to the cards", async () => {
    render(<NewProject platform="somm.finance" />);

    fireEvent.click(await screen.findByRole("button", IMPORT_CARD));
    expect(
      screen.getByText("Connect repository to somm.finance"),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: /Choose a different start/ }),
    );
    expect(screen.getByRole("button", TEMPLATE_CARD)).toBeVisible();
    await waitFor(() =>
      expect(new URL(window.location.href).searchParams.has("mode")).toBe(
        false,
      ),
    );
  });

  it("resumes the template flow when GitHub returns mid-install", async () => {
    window.history.replaceState(
      {},
      "",
      "/operate/deployments/new?installation_id=99",
    );
    render(<NewProject platform="somm.finance" />);

    expect(
      await screen.findByText("Template wizard for somm.finance"),
    ).toBeVisible();
  });

  it("resumes a deploy the user navigated away from mid-flight", async () => {
    saveLaunch({
      platform: "somm.finance",
      path: "oneshot",
      oneshot: { installationId: "42", repo: "alice/bot", deploymentId: "d-1" },
      pendingInstall: null,
      rejectedInstallationId: null,
    });
    render(<NewProject platform="somm.finance" />);

    expect(
      await screen.findByText("Template wizard for somm.finance"),
    ).toBeVisible();
  });

  it("offers the cards again once a launch has gone live", async () => {
    saveLaunch({
      platform: "somm.finance",
      path: "oneshot",
      oneshot: {
        installationId: "42",
        repo: "alice/bot",
        deploymentId: "d-1",
        live: true,
      },
      pendingInstall: null,
      rejectedInstallationId: null,
    });
    render(<NewProject platform="somm.finance" />);

    expect(await screen.findByRole("button", TEMPLATE_CARD)).toBeVisible();
    expect(screen.queryByText(/Template wizard/)).toBeNull();
  });

  it("honours an explicit mode from the URL", async () => {
    render(<NewProject platform="somm.finance" mode="import" />);

    expect(
      await screen.findByText("Connect repository to somm.finance"),
    ).toBeVisible();
  });

  it("follows `?mode=` when it changes under a mounted page", async () => {
    const { rerender } = render(
      <NewProject platform="somm.finance" mode="import" />,
    );
    expect(
      await screen.findByText("Connect repository to somm.finance"),
    ).toBeVisible();

    // A soft navigation to the same route without `?mode=` — the picker has to
    // come back rather than stranding the user in the import flow.
    rerender(<NewProject platform="somm.finance" />);
    expect(screen.getByRole("button", TEMPLATE_CARD)).toBeVisible();

    rerender(<NewProject platform="somm.finance" mode="template" />);
    expect(screen.getByText("Template wizard for somm.finance")).toBeVisible();
  });

  it("asks for GitHub sign-in before showing the cards", async () => {
    fetchGitHubSession.mockResolvedValue({
      signedIn: false,
      githubLogin: null,
    });
    render(<NewProject platform="somm.finance" />);

    expect(await screen.findByText("Sign in with GitHub")).toBeVisible();
    expect(screen.queryByRole("button", TEMPLATE_CARD)).toBeNull();
  });
});

describe("newProjectMode", () => {
  it("accepts only the two known modes", () => {
    expect(newProjectMode("template")).toBe("template");
    expect(newProjectMode("import")).toBe("import");
    expect(newProjectMode("nonsense")).toBeUndefined();
    expect(newProjectMode(["template"])).toBeUndefined();
    expect(newProjectMode(undefined)).toBeUndefined();
  });
});
