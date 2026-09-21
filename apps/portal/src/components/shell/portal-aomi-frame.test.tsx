import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { PortalAomiFrame, ThreadUrlBootstrap } from "./portal-aomi-frame";

const walletKitState = vi.hoisted(() => ({
  current: {
    accountStatus: "loading",
    accountUser: undefined,
  } as {
    accountStatus: "loading" | "ready" | "error";
    accountUser?: { id: string };
  },
}));
const frameInstances = vi.hoisted(() => ({ next: 0 }));
const backendUrlState = vi.hoisted(() => ({
  current: "https://api.example.test",
}));
const requestedAppState = vi.hoisted(() => ({
  current: {
    app: null,
    applicationId: null,
    locked: false,
  } as {
    app: string | null;
    applicationId: string | null;
    locked: boolean;
  },
}));
const runtimeState = vi.hoisted(() => ({
  current: {
    currentThreadId: "initial",
    threadMetadata: new Map<string, unknown>(),
    selectThread: vi.fn(),
    createThread: vi.fn(async () => "thread-new"),
  },
}));

vi.mock("@aomi-labs/react", () => ({
  useAomiRuntime: () => runtimeState.current,
  usePerThreadControl: () => ({ actions: { onAppSelect: vi.fn() } }),
}));

vi.mock("@aomi-labs/widget-lib", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    AomiFrame: {
      Root: ({
        accountSessionAvailable,
        applicationId,
        agentTarget,
        children,
        showSidebar,
        persistThread,
        threadPersistenceScope,
      }: {
        accountSessionAvailable: boolean;
        applicationId?: string | null;
        agentTarget?: unknown;
        children?: React.ReactNode;
        showSidebar?: boolean;
        persistThread?: boolean;
        threadPersistenceScope?: string | null;
      }) => {
        const [instance] = React.useState(() => ++frameInstances.next);
        // Renders children: the real Root mounts the Aomi runtime around
        // them, so anything the portal shell nests here must stay nested.
        return (
          <div
            data-account-session-available={String(accountSessionAvailable)}
            data-application-id={applicationId ?? ""}
            data-agent-target={agentTarget ? JSON.stringify(agentTarget) : ""}
            data-instance={instance}
            data-show-sidebar={String(showSidebar)}
            data-persist-thread={String(persistThread)}
            data-thread-persistence-scope={threadPersistenceScope ?? ""}
            data-testid="aomi-frame"
          >
            {children}
          </div>
        );
      },
      Header: ({ children }: { children?: React.ReactNode }) => (
        <div>{children}</div>
      ),
      Composer: ({
        controlBarProps,
      }: {
        controlBarProps?: { routing?: unknown };
      }) => (
        <div
          data-routing={JSON.stringify(controlBarProps?.routing)}
          data-testid="composer"
        />
      ),
    },
    useAomiWalletKit: () => walletKitState.current,
  };
});

vi.mock("@portal/lib/portal-client-options", () => ({
  usePortalClientOptions: () => ({}),
  useRequestedAppConfig: () => requestedAppState.current,
}));

vi.mock("@aomi-labs/widget-lib/host-composition", () => ({
  getBackendUrl: () => backendUrlState.current,
  HeaderControls: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <button type="button" onClick={onOpenSettings}>
      Open settings
    </button>
  ),
  PackagesModal: () => <div data-testid="packages-modal" />,
  SettingsModal: () => <div data-testid="settings-modal" />,
  useAccountOverview: () => null,
  usePortalWalletAccountMenu: () => undefined,
}));

// Renders in place so the assertion below can check where the overlay is
// mounted in the React tree; the real component portals it to <body>.
vi.mock("@portal/components/shell/overlay-portal", () => ({
  OverlayPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@portal/features/general/svm-wallet-binding-gate", () => ({
  SvmWalletBindingGate: () => null,
}));

describe("PortalAomiFrame account bootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    frameInstances.next = 0;
    backendUrlState.current = "https://api.example.test";
    walletKitState.current = {
      accountStatus: "loading",
      accountUser: undefined,
    };
    requestedAppState.current = {
      app: null,
      applicationId: null,
      locked: false,
    };
  });

  it("waits for the initial account lookup before mounting the frame", async () => {
    const view = render(<PortalAomiFrame />);

    expect(screen.queryByTestId("aomi-frame")).toBeNull();
    expect(document.querySelector('main[aria-busy="true"]')).not.toBeNull();

    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    await act(async () => {
      view.rerender(<PortalAomiFrame />);
    });

    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "true",
    );
    expect(document.querySelector('main[aria-busy="true"]')).toBeNull();
  });

  it("mounts settings inside the frame so it can read the Aomi runtime", async () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    render(<PortalAomiFrame />);

    await act(async () => {
      screen.getByRole("button", { name: "Open settings" }).click();
    });

    // Rendered as a sibling of the frame, the settings account tab sees no
    // runtime and reports "Open a chat thread before enabling automatic
    // signing." with a chat open. It must stay a descendant.
    expect(screen.getByTestId("aomi-frame")).toContainElement(
      screen.getByTestId("settings-modal"),
    );
  });

  it("mounts the anonymous frame after a signed-out lookup resolves", async () => {
    const view = render(<PortalAomiFrame />);

    walletKitState.current = {
      accountStatus: "error",
      accountUser: undefined,
    };
    await act(async () => {
      view.rerender(<PortalAomiFrame />);
    });

    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "false",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-persist-thread",
      "false",
    );
  });

  it("shows the real Chat frame while guest identity is still resolving", async () => {
    backendUrlState.current = "/";
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: undefined,
    };
    let resolveSession!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveSession = resolve;
          }),
      ),
    );

    render(<PortalAomiFrame />);

    expect(screen.getByTestId("portal-shell")).toBeVisible();
    expect(screen.getByTestId("portal-shell")).toHaveAttribute("inert");
    expect(screen.getByTestId("portal-shell")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "false",
    );

    resolveSession(
      Response.json({ user: { id: "guest-1", isAnonymous: true } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("portal-shell")).not.toHaveAttribute("inert"),
    );
    expect(screen.getByTestId("portal-shell")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "true",
    );
  });

  it("unblocks the real Chat frame when guest lookup times out", async () => {
    vi.useFakeTimers();
    backendUrlState.current = "/";
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: undefined,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );

    render(<PortalAomiFrame />);
    expect(screen.getByTestId("portal-shell")).toHaveAttribute("inert");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.getByTestId("portal-shell")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("portal-shell")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("loads guest-owned threads only after Better Auth confirms this browser's anonymous session", async () => {
    backendUrlState.current = "/";
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: undefined,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: "guest-1", isAnonymous: true },
        }),
      ),
    );
    render(<PortalAomiFrame />);

    await waitFor(() =>
      expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
        "data-account-session-available",
        "true",
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/get-session",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-persist-thread",
      "false",
    );
  });

  it("does not unlock a guest thread list for a non-anonymous session", async () => {
    backendUrlState.current = "/";
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: undefined,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          user: { id: "other-user", isAnonymous: false },
        }),
      ),
    );
    render(<PortalAomiFrame />);

    await waitFor(() =>
      expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
        "data-account-session-available",
        "false",
      ),
    );
  });

  it("offers Auto and Direct while keeping Auto as the Portal default", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    render(<PortalAomiFrame />);

    expect(JSON.parse(screen.getByTestId("composer").dataset.routing!)).toEqual(
      {
        targets: [
          { mode: "auto" },
          { mode: "direct", apps: [{ app: "default" }] },
        ],
        defaultMode: "auto",
      },
    );
  });

  it("starts fresh when sign-in establishes an account", async () => {
    walletKitState.current = {
      accountStatus: "error",
      accountUser: undefined,
    };
    const view = render(<PortalAomiFrame />);
    const initialInstance = screen
      .getByTestId("aomi-frame")
      .getAttribute("data-instance");

    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    await act(async () => {
      view.rerender(<PortalAomiFrame />);
    });

    expect(screen.getByTestId("aomi-frame")).not.toHaveAttribute(
      "data-instance",
      initialInstance,
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "true",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-persist-thread",
      "false",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-thread-persistence-scope",
      "",
    );
  });

  it("remounts when an authenticated account changes or signs out", async () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    const view = render(<PortalAomiFrame />);
    const accountAInstance = screen
      .getByTestId("aomi-frame")
      .getAttribute("data-instance");

    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-b" },
    };
    await act(async () => {
      view.rerender(<PortalAomiFrame />);
    });
    const accountBInstance = screen
      .getByTestId("aomi-frame")
      .getAttribute("data-instance");
    expect(accountBInstance).not.toBe(accountAInstance);

    walletKitState.current = {
      accountStatus: "ready",
      accountUser: undefined,
    };
    await act(async () => {
      view.rerender(<PortalAomiFrame />);
    });
    expect(screen.getByTestId("aomi-frame")).not.toHaveAttribute(
      "data-instance",
      accountBInstance,
    );
  });

  it("isolates a locked project chat to its application", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    requestedAppState.current = {
      app: "goal-digger",
      applicationId: "2936682",
      locked: true,
    };

    render(<PortalAomiFrame />);

    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-application-id",
      "2936682",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-show-sidebar",
      "true",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-agent-target",
      JSON.stringify({
        mode: "direct",
        app: "goal-digger",
        applicationId: 2936682,
      }),
    );
    expect(JSON.parse(screen.getByTestId("composer").dataset.routing!)).toEqual(
      {
        targets: [
          {
            mode: "direct",
            apps: [{ app: "goal-digger", applicationId: 2936682 }],
          },
        ],
        defaultMode: "direct",
        showFixedControls: true,
      },
    );
  });
});

describe("ThreadUrlBootstrap", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    runtimeState.current = {
      currentThreadId: "initial",
      threadMetadata: new Map<string, unknown>(),
      selectThread: vi.fn(),
    };
  });

  it("waits for remote metadata before selecting a linked MCP thread", async () => {
    window.history.replaceState({}, "", "/?thread=mcp-linked");
    const view = render(<ThreadUrlBootstrap />);
    expect(runtimeState.current.selectThread).not.toHaveBeenCalled();

    runtimeState.current = {
      ...runtimeState.current,
      threadMetadata: new Map([["mcp-linked", {}]]),
    };
    await act(async () => {
      view.rerender(<ThreadUrlBootstrap />);
    });

    expect(runtimeState.current.selectThread).toHaveBeenCalledOnce();
    expect(runtimeState.current.selectThread).toHaveBeenCalledWith(
      "mcp-linked",
    );
  });
});
