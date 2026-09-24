import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "@build/components/control-plane/toast";
import { EnvironmentTab } from "./environment-tab";

const setEnvVars = vi.fn(async () => ({ ok: true, keys: ["API_KEY"] }));
const deleteEnvVar = vi.fn(async () => ({ ok: true, removed: true }));
const writeText = vi.fn(async () => undefined);

const detail = {
  source: {
    id: 1,
    installationId: 5,
    repositoryLink: "a/b",
    apps: [{ id: 11, name: "demo", isActive: true, loaded: true }],
    latestDeployment: null,
  },
  loadSecrets: vi.fn(),
  loadRequiredSecrets: vi.fn(),
  setEnvVars,
  deleteEnvVar,
  secretsByApp: { demo: ["$SECRET:APP:demo::EXISTING_KEY"] },
  secretsError: null,
  requiredSecrets: null,
  requiredSecretsError: null,
} as unknown as ReturnType<
  typeof import("@build/features/launch/hooks/use-project-detail").useProjectDetail
>;

function renderTab(props: { detail?: typeof detail } = {}) {
  return render(
    <ToastProvider>
      <EnvironmentTab detail={props.detail ?? detail} />
    </ToastProvider>,
  );
}

describe("EnvironmentTab", () => {
  beforeEach(() => {
    setEnvVars.mockClear();
    deleteEnvVar.mockClear();
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("loads secrets on mount and lists configured keys (names only)", () => {
    renderTab();
    expect(detail.loadSecrets).toHaveBeenCalled();
    expect(detail.loadRequiredSecrets).toHaveBeenCalled();
    expect(screen.getByText("EXISTING_KEY")).toBeInTheDocument();
    expect(screen.getByText("Builder secret")).toBeInTheDocument();
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByLabelText("Value hidden")).toHaveTextContent("••••");
    expect(
      screen.getByRole("button", { name: /save values/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Env")).not.toBeInTheDocument();
  });

  it("keeps the environment shell and app scope stable while keys load", () => {
    renderTab({
      detail: {
        ...detail,
        secretsByApp: null,
      } as typeof detail,
    });

    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getAllByText("demo")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading environment…",
    );
    expect(screen.getByRole("button", { name: /save values/i })).toBeDisabled();
  });

  it("does not reload keys when unrelated detail state changes", () => {
    detail.loadSecrets.mockClear();
    detail.loadRequiredSecrets.mockClear();
    const view = renderTab();

    view.rerender(
      <ToastProvider>
        <EnvironmentTab
          detail={
            {
              ...detail,
              requiredSecretsError: "temporary failure",
            } as typeof detail
          }
        />
      </ToastProvider>,
    );

    expect(detail.loadSecrets).toHaveBeenCalledOnce();
    expect(detail.loadRequiredSecrets).toHaveBeenCalledOnce();
  });

  it("tells one vault story in the helper copy", () => {
    renderTab();
    expect(
      screen.getByText(/API keys and secrets for an app/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/chat users never paste API keys/i),
    ).toBeInTheDocument();
  });

  it("writes masked vault values through the single editor", async () => {
    renderTab();
    const value = screen.getByLabelText("Environment value");
    expect(value).toHaveAttribute("type", "password");

    fireEvent.change(screen.getByLabelText("Environment key"), {
      target: { value: "API_KEY" },
    });
    fireEvent.change(value, {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save values/i }));
    await waitFor(() =>
      expect(setEnvVars).toHaveBeenCalledWith(11, {
        API_KEY: "secret",
      }),
    );
  });

  it("copies, overwrites, and deletes configured keys", async () => {
    renderTab();

    fireEvent.click(screen.getByTitle("Copy EXISTING_KEY"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("EXISTING_KEY"));

    fireEvent.click(screen.getByTitle("Overwrite EXISTING_KEY"));
    expect(screen.getByLabelText("Environment key")).toHaveValue(
      "EXISTING_KEY",
    );
    expect(screen.getByLabelText("Environment value")).toHaveValue("");

    fireEvent.click(screen.getByTitle("Delete EXISTING_KEY"));
    await waitFor(() =>
      expect(deleteEnvVar).toHaveBeenCalledWith(11, "EXISTING_KEY"),
    );
  });

  it("shows secret load failures", () => {
    renderTab({
      detail: {
        ...detail,
        secretsByApp: null,
        secretsError: "vault unavailable",
      } as typeof detail,
    });
    expect(screen.getByText("vault unavailable")).toBeInTheDocument();
  });

  it("shows builder empty copy when no vars", () => {
    renderTab({
      detail: {
        ...detail,
        secretsByApp: { demo: [] },
      } as typeof detail,
    });
    expect(screen.getByText("No variables yet")).toBeInTheDocument();
    expect(screen.getByText(/Add keys your agent needs/i)).toBeInTheDocument();
  });

  it("lists missing required slots in the unified view (no inline inputs)", () => {
    const requiredDetail = {
      ...detail,
      requiredSecrets: {
        demo: {
          applicationId: 11,
          slots: [
            {
              name: "DEMO_API_KEY",
              description: "Key from the demo provider.",
              required: true,
            },
          ],
          missing: ["DEMO_API_KEY"],
        },
      },
    } as typeof detail;
    renderTab({ detail: requiredDetail });
    expect(screen.getByText("Key from the demo provider.")).toBeInTheDocument();
    expect(screen.getByText(/1 required secret missing/i)).toBeInTheDocument();
    // Missing slots are list rows, not editor inputs.
    expect(screen.queryByLabelText("DEMO_API_KEY value")).toBeNull();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.getByLabelText("Required")).toBeInTheDocument();
    // Configured key sits in the same list as the missing slot.
    expect(screen.getByText("EXISTING_KEY")).toBeInTheDocument();
    // Set value prefills the editor with the slot's key.
    fireEvent.click(screen.getByTitle("Set DEMO_API_KEY"));
    expect(screen.getByLabelText("Environment key")).toHaveValue(
      "DEMO_API_KEY",
    );
  });

  it("keeps user-owned slots out of the Builder environment", () => {
    const requiredDetail = {
      ...detail,
      secretsByApp: {
        demo: [
          "$SECRET:APP:demo::EXISTING_KEY",
          "$SECRET:APP:demo::USER_TRADING_KEY",
        ],
      },
      requiredSecrets: {
        demo: {
          applicationId: 11,
          slots: [
            {
              name: "BUILDER_KEY",
              description: "Builder service key.",
              required: true,
            },
            {
              name: "USER_TRADING_KEY",
              description: "Each chat user supplies this.",
              required: true,
              user_own: true,
            },
          ],
          missing: ["BUILDER_KEY", "USER_TRADING_KEY"],
        },
      },
    } as typeof detail;

    renderTab({ detail: requiredDetail });

    expect(screen.getByText("BUILDER_KEY")).toBeInTheDocument();
    expect(screen.getByText(/1 required secret missing/i)).toBeInTheDocument();
    expect(screen.queryByText("USER_TRADING_KEY")).toBeNull();
    expect(screen.queryByText("Each chat user supplies this.")).toBeNull();
  });

  it("lists an app the gate flagged but the source snapshot predates", () => {
    // A deploy re-syncs the source from the repo, so the required-secret check
    // can name an app this page's `source.apps` does not have yet. Without the
    // union the user is told a secret is missing with nowhere to enter it.
    const freshAppDetail = {
      ...detail,
      secretsByApp: { demo: [] },
      requiredSecrets: {
        demo: { applicationId: 11, slots: [], missing: [] },
        "demo-bot": {
          applicationId: 12,
          slots: [
            {
              name: "TELEGRAM_BOT_TOKEN",
              description: "Token from BotFather.",
              required: true,
            },
          ],
          missing: ["TELEGRAM_BOT_TOKEN"],
        },
      },
    } as typeof detail;
    renderTab({ detail: freshAppDetail });

    fireEvent.click(screen.getByRole("tab", { name: "demo-bot" }));
    expect(screen.getByText("TELEGRAM_BOT_TOKEN")).toBeInTheDocument();
    expect(screen.getByText(/1 required secret missing/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Set TELEGRAM_BOT_TOKEN"));
    expect(screen.getByLabelText("Environment key")).toHaveValue(
      "TELEGRAM_BOT_TOKEN",
    );
  });

  it("explains an unverifiable required-secret check instead of an empty list", () => {
    renderTab({
      detail: {
        ...detail,
        requiredSecretsError: "Unable to verify required secrets. Try again.",
        refreshRequiredSecrets: vi.fn(async () => ({})),
      } as unknown as typeof detail,
    });
    expect(
      screen.getByText(/Required secrets could not be verified/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("marks required vs optional slots with an asterisk", () => {
    const requiredDetail = {
      ...detail,
      secretsByApp: { demo: [] },
      requiredSecrets: {
        demo: {
          applicationId: 11,
          slots: [
            {
              name: "DEMO_API_KEY",
              description: "Key from the demo provider.",
              required: true,
            },
            {
              name: "DEMO_BASE_URL",
              description: "Optional override.",
              required: false,
            },
          ],
          missing: ["DEMO_API_KEY"],
        },
      },
    } as typeof detail;
    renderTab({ detail: requiredDetail });
    // Both slots render as rows; only the required one carries the asterisk.
    expect(screen.getByText("DEMO_BASE_URL")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Required")).toHaveLength(1);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(
      screen.getByText(/cannot be activated without it/i),
    ).toBeInTheDocument();
  });
});
