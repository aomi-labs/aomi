import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OneshotWizard } from "./oneshot-wizard";
import {
  deploymentRequiredSecrets,
  deploymentSetSecrets,
  launchCreateRepo,
} from "@build/features/launch";
import type { LaunchProgress } from "@build/features/launch";

const noop = () => {};

vi.mock("@aomi-labs/widget-lib", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      type="button"
    >
      {children}
    </button>
  ),
}));

// `@build/lib/chat-url` is intentionally NOT mocked: it is a pure helper and
// a stale fake here previously dropped `application_id` from asserted URLs.

vi.mock("@build/features/launch", () => ({
  oneshotStep: (p: LaunchProgress) => {
    if (p.live) return "live";
    if (p.deploymentId || p.deployment) return "build";
    if (p.repo) return "create";
    if (p.installationId) return "create";
    return "install";
  },
  installationStatusLabel: () => null,
  launchCreateRepo: vi.fn(),
  deploymentRequiredSecrets: vi.fn(),
  deploymentSetSecrets: vi.fn(),
  // DeployStep (rendered at the "build" step) imports these too; they're
  // only invoked from button clicks / a polling timer this suite never
  // triggers, but they must exist so the mocked module doesn't crash on
  // reference.
  launchPreflight: vi.fn(),
  launchDeploy: vi.fn(),
  launchStatus: vi.fn(),
  launchActivate: vi.fn(),
  launchAppsStatus: vi.fn(),
  TEMPLATE_REPO: "aomi-labs/playground-example",
  TEMPLATE_REPO_URL: "https://github.com/aomi-labs/playground-example",
}));

function baseProgress(): LaunchProgress {
  return {};
}

describe("OneshotWizard", () => {
  const defaultProps = {
    progress: baseProgress(),
    actor: "test-user",
    beginInstall: noop,
    installing: false,
    installError: null,
    patch: noop,
  };

  it("shows install step by default", () => {
    render(<OneshotWizard {...defaultProps} />);
    expect(screen.getByText(/Install the Aomi GitHub App/)).toBeInTheDocument();
  });

  it("shows the install button", () => {
    render(<OneshotWizard {...defaultProps} />);
    expect(screen.getByText("Install on GitHub")).toBeInTheDocument();
  });

  // GitHub renders its configure page — which never redirects back — instead
  // of re-running an install for an account that already has one. Without a
  // second door, "Install on GitHub" is a dead end for those users.
  it("offers the authorize ceremony for an already-installed account", () => {
    const beginInstall = vi.fn();
    render(<OneshotWizard {...defaultProps} beginInstall={beginInstall} />);
    fireEvent.click(screen.getByText("Already installed — continue"));
    expect(beginInstall).toHaveBeenCalledWith("authorize");
  });

  it("asks for the install ceremony from the primary button", () => {
    const beginInstall = vi.fn();
    render(<OneshotWizard {...defaultProps} beginInstall={beginInstall} />);
    fireEvent.click(screen.getByText("Install on GitHub"));
    expect(beginInstall).toHaveBeenCalledWith("install");
  });

  it("disables both install doors while a redirect is in flight", () => {
    render(<OneshotWizard {...defaultProps} installing />);
    expect(screen.getByText("Already installed — continue")).toBeDisabled();
  });

  it("shows live panel when live", () => {
    render(
      <OneshotWizard
        {...defaultProps}
        progress={{
          ...baseProgress(),
          live: true,
          apps: ["my-agent"],
          applicationId: "42",
        }}
      />,
    );
    expect(screen.getByText(/Your agent is live/)).toBeInTheDocument();
    expect(screen.getByTitle("Chat with your agent")).toHaveAttribute(
      "src",
      "https://chat-staging.aomi.dev?app=my-agent&application_id=42&lock_app=1",
    );
  });

  it("shows error when installError is set", () => {
    render(
      <OneshotWizard {...defaultProps} installError="Installation failed" />,
    );
    expect(screen.getByText("Installation failed")).toBeInTheDocument();
  });

  it("disables install button while installing", () => {
    render(<OneshotWizard {...defaultProps} installing />);
    expect(screen.getByText("Waiting for GitHub...")).toBeInTheDocument();
    expect(screen.getByText("Waiting for GitHub...")).toBeDisabled();
  });

  it("renders stepper with correct steps", () => {
    render(<OneshotWizard {...defaultProps} />);
    expect(screen.getByText("Install")).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("shows the wizard title", () => {
    render(<OneshotWizard {...defaultProps} />);
    expect(screen.getByText("Deploy your agent")).toBeInTheDocument();
  });

  it("offers start over once there is progress", () => {
    const onRestart = vi.fn();

    render(
      <OneshotWizard
        {...defaultProps}
        progress={{ installationId: "1" }}
        onRestart={onRestart}
      />,
    );

    fireEvent.click(screen.getByText("Start over"));
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it("passes the custom repo name when creating a repo", async () => {
    vi.mocked(launchCreateRepo).mockResolvedValue({
      ok: true,
      repo: "alice/custom-playground",
      installationId: "12345",
      projectId: 7,
      sourceRef: "abc123",
    });
    const patch = vi.fn();

    render(
      <OneshotWizard
        {...defaultProps}
        platform="somm.finance"
        progress={{ installationId: "12345" }}
        patch={patch}
      />,
    );

    fireEvent.change(screen.getByLabelText("Repo name"), {
      target: { value: "custom-playground" },
    });
    fireEvent.click(screen.getByText("Create repo"));

    await waitFor(() => {
      expect(launchCreateRepo).toHaveBeenCalledWith({
        installationId: "12345",
        platform: "somm.finance",
        repoName: "custom-playground",
      });
    });
  });

  it("wires progress.projectId into DeployStep's required-secrets gate at the build step", async () => {
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({
      byApp: {
        "my-bot": {
          applicationId: 71,
          slots: [],
          missing: ["MY_BOT_API_KEY"],
        },
      },
    });

    render(
      <OneshotWizard
        {...defaultProps}
        progress={{
          installationId: "12345",
          repo: "alice/bot",
          projectId: 7,
          deploymentId: "dep_1",
          apps: ["my-bot"],
        }}
      />,
    );

    await waitFor(() => {
      expect(deploymentRequiredSecrets).toHaveBeenCalledWith({
        projectId: 7,
      });
    });
    expect(
      await screen.findByText(/1 required secret missing/i),
    ).toBeInTheDocument();
  });

  it("lets a new project save the missing required secret before activation", async () => {
    vi.mocked(deploymentRequiredSecrets).mockResolvedValue({
      byApp: {
        "my-bot": {
          applicationId: 71,
          slots: [
            {
              name: "MY_BOT_API_KEY",
              description: "API key for the bot.",
              required: true,
            },
          ],
          missing: ["MY_BOT_API_KEY"],
        },
      },
    });

    render(
      <OneshotWizard
        {...defaultProps}
        progress={{
          installationId: "12345",
          repo: "alice/bot",
          projectId: 7,
          deploymentId: "dep_1",
          apps: ["my-bot"],
        }}
      />,
    );

    const input = await screen.findByLabelText("my-bot MY_BOT_API_KEY");
    fireEvent.change(input, { target: { value: "secret-value" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save required secrets" }),
    );

    await waitFor(() =>
      expect(deploymentSetSecrets).toHaveBeenCalledWith({
        applicationId: 71,
        secrets: { MY_BOT_API_KEY: "secret-value" },
      }),
    );
  });
});
