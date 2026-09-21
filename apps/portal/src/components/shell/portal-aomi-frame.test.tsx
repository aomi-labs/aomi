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
const controlState = vi.hoisted(() => ({
  appDescriptors: [] as Array<{
    name: string;
    applicationId?: number | string | null;
  }>,
}));
const accountOverviewState = vi.hoisted(() => ({
  current: null as null | { user: { user_id: string; apps?: string[] } },
}));

vi.mock("@aomi-labs/react", () => ({
  useAomiRuntime: () => runtimeState.current,
  useControl: () => ({ state: controlState }),
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
  useAccountOverview: () => accountOverviewState.current,
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
    controlState.appDescriptors = [];
    accountOverviewState.current = null;
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

  it("renders the welcome shell while account initialization is pending", () => {
    render(<PortalAomiFrame />);
    expect(
      screen.getByRole("heading", { name: "What should happen on-chain?" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.queryByTestId("aomi-frame")).toBeNull();
  });

  it("offers recovery when account initialization never settles", async () => {
    vi.useFakeTimers();
    render(<PortalAomiFrame />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByTestId("aomi-frame")).toBeNull();
  });

  it("does not mount a stale guest runtime while sign-out is being checked", async () => {
    backendUrlState.current = "/";
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "account-a" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const view = render(<PortalAomiFrame />);
    expect(screen.getByTestId("aomi-frame")).toBeVisible();
    walletKitState.current = { accountStatus: "ready" };
    await act(async () => view.rerender(<PortalAomiFrame />));
    expect(screen.getByTestId("portal-startup-shell")).toBeVisible();
    expect(screen.queryByTestId("aomi-frame")).toBeNull();
  });

  it("keeps the shell visible during a slow guest lookup, then restores guest history", async () => {
    backendUrlState.current = "/";
    walletKitState.current = { accountStatus: "ready" };
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    render(<PortalAomiFrame />);
    expect(screen.getByTestId("portal-startup-shell")).toBeVisible();
    expect(screen.queryByTestId("aomi-frame")).toBeNull();
    await act(async () =>
      resolve(Response.json({ user: { id: "guest-1", isAnonymous: true } })),
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "true",
    );
  });

  it("times out a hung lookup and retries without silently creating a new guest", async () => {
    vi.useFakeTimers();
    backendUrlState.current = "/";
    walletKitState.current = { accountStatus: "ready" };
    let lateResponse!: (response: Response) => void;
    const fetchSession = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((done) => {
            lateResponse = done;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({ user: { id: "guest-2", isAnonymous: true } }),
      );
    vi.stubGlobal("fetch", fetchSession);
    render(<PortalAomiFrame />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByTestId("aomi-frame")).toBeNull();
    expect(fetchSession.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () =>
      screen.getByRole("button", { name: "Retry" }).click(),
    );
    const instance = screen.getByTestId("aomi-frame").dataset.instance;
    await act(async () =>
      lateResponse(
        Response.json({ user: { id: "stale-guest", isAnonymous: true } }),
      ),
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-instance",
      instance,
    );
    expect(fetchSession).toHaveBeenCalledTimes(2);
  });

  it.each([503, 401])(
    "shows recovery instead of admitting a guest after HTTP %s",
    async (status) => {
      backendUrlState.current = "/";
      walletKitState.current = { accountStatus: "ready" };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({}, { status })),
      );
      render(<PortalAomiFrame />);
      expect(
        await screen.findByRole("button", { name: "Retry" }),
      ).toBeVisible();
      expect(screen.queryByTestId("aomi-frame")).toBeNull();
    },
  );

  it("ignores a pending guest response after sign-in changes the principal", async () => {
    backendUrlState.current = "/";
    walletKitState.current = { accountStatus: "ready" };
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const view = render(<PortalAomiFrame />);
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "account-new" },
    };
    await act(async () => view.rerender(<PortalAomiFrame />));
    const instance = screen.getByTestId("aomi-frame").dataset.instance;
    await act(async () =>
      resolve(
        Response.json({ user: { id: "stale-guest", isAnonymous: true } }),
      ),
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-instance",
      instance,
    );
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
    expect(fetch).toHaveBeenCalledWith("/api/auth/get-session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
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

  it("routes an installed hosted app by canonical application ID", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    accountOverviewState.current = {
      user: { user_id: "acct-a", apps: ["default", "credential-demo"] },
    };
    controlState.appDescriptors = [
      { name: "default", applicationId: null },
      { name: "credential-demo", applicationId: 16 },
    ];

    render(<PortalAomiFrame />);

    expect(JSON.parse(screen.getByTestId("composer").dataset.routing!)).toEqual(
      {
        targets: [
          { mode: "auto" },
          {
            mode: "direct",
            apps: [
              { app: "default" },
              { app: "credential-demo", applicationId: 16 },
            ],
          },
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
