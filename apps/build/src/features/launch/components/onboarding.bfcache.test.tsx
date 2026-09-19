/**
 * Onboarding — back/forward-cache restore clears the in-flight install state.
 *
 * `beginInstall` sets `installing` and then navigates to GitHub. When the App
 * is already installed GitHub renders its *configure* page, which never
 * redirects back, so the user's only way out is Back. A bfcache restore does
 * not remount the component, so the hydrate effect never re-runs and
 * `installing` stays true — disabling every install button, including the
 * "Already installed — continue" recovery path that exists precisely for this
 * dead end. Only `pageshow` with `persisted: true` reports that restore.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Onboarding } from "./onboarding";

vi.mock("@aomi-labs/widget-lib", () => ({
  useAomiWalletKit: () => ({ identity: {}, isConnected: false }),
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled} type="button">
      {children}
    </button>
  ),
}));

// Keep the real helpers (state transitions, labels, step math) and stub only
// the two things a test must not do: talk to GitHub, and persist to storage.
vi.mock("@build/features/launch", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    githubAppInstallUrl: vi.fn(async () => "https://github.test/install"),
    saveLaunch: vi.fn(),
  };
});

vi.mock("@build/features/launch/platform", () => ({
  readPlatform: () => "community",
}));
vi.mock("@build/lib/deploy-platform", () => ({
  DEFAULT_DEPLOY_PLATFORM: "community",
}));

function firePageShow(persisted: boolean) {
  const event = new Event("pageshow") as Event & { persisted?: boolean };
  Object.defineProperty(event, "persisted", { value: persisted });
  window.dispatchEvent(event);
}

describe("Onboarding bfcache restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom forbids assigning window.location.href; stub the navigation that
    // beginInstall performs so the component reaches its `installing` state.
    // jsdom forbids assigning window.location.href, and the component reads it
    // through `new URL(...)`, so the stub must stay a valid absolute URL.
    Object.defineProperty(window, "location", {
      value: {
        href: "https://build.test/operate/deployments/new",
        origin: "https://build.test",
        search: "",
        assign: () => {},
        replace: () => {},
      },
      writable: true,
      configurable: true,
    });
  });

  it("re-enables the recovery button after a restore from bfcache", async () => {
    render(<Onboarding />);

    const recovery = screen.getByRole("button", {
      name: /already installed/i,
    });
    expect(recovery).not.toBeDisabled();

    // Start the install: the component navigates away and marks itself busy.
    fireEvent.click(screen.getByRole("button", { name: /install on github/i }));
    await waitFor(() => expect(recovery).toBeDisabled());

    // The user hits Back from GitHub's configure page. Without the pageshow
    // handler this stays disabled forever and the flow is unrecoverable.
    firePageShow(true);
    await waitFor(() => expect(recovery).not.toBeDisabled());
  });

  it("leaves the in-flight state alone on a normal (non-restored) pageshow", async () => {
    render(<Onboarding />);

    const recovery = screen.getByRole("button", {
      name: /already installed/i,
    });
    fireEvent.click(screen.getByRole("button", { name: /install on github/i }));
    await waitFor(() => expect(recovery).toBeDisabled());

    // A fresh load fires pageshow with persisted:false; that is not a restore
    // and must not clear a genuinely in-flight install.
    firePageShow(false);
    expect(recovery).toBeDisabled();
  });
});
