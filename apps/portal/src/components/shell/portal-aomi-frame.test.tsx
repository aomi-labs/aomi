import { act, render, screen } from "@testing-library/react";
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
        children,
        showSidebar,
        persistThread,
        threadPersistenceScope,
      }: {
        accountSessionAvailable: boolean;
        applicationId?: string | null;
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
      Composer: () => null,
    },
    useAomiWalletKit: () => walletKitState.current,
  };
});

vi.mock("@portal/lib/portal-client-options", () => ({
  usePortalClientOptions: () => ({}),
  useRequestedAppConfig: () => requestedAppState.current,
}));

vi.mock("@portal/lib/settings-api", () => ({
  getBackendUrl: () => "https://api.example.test",
}));

vi.mock("@portal/components/shell/use-portal-wallet-account-menu", () => ({
  usePortalWalletAccountMenu: () => undefined,
}));

vi.mock("@portal/components/shell/header-controls", () => ({
  HeaderControls: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <button type="button" onClick={onOpenSettings}>
      Open settings
    </button>
  ),
}));

vi.mock("@portal/components/settings/settings-modal", () => ({
  SettingsModal: () => <div data-testid="settings-modal" />,
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
    frameInstances.next = 0;
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

  it("isolates anonymous threads when sign-in establishes an account", async () => {
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
      "data-thread-persistence-scope",
      "acct-a",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-persist-thread",
      "true",
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
      "false",
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
