import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState, type ReactNode } from "react";
import {
  MessagePrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  useMessage,
} from "@assistant-ui/react";
import { AssistantRuntimeBoundary } from "../../../../../packages/react/src/runtime/assistant-runtime-boundary";

import {
  PortalAomiFrame,
  ThreadUrlBootstrap,
  createThreadUrlNavigation,
} from "./portal-aomi-frame";

const walletKitState = vi.hoisted(() => ({
  current: {
    accountStatus: "loading",
    accountUser: undefined,
  } as {
    accountStatus?: "loading" | "ready" | "error";
    isReady?: boolean;
    accountUser?: { id: string };
    accountGuest?: boolean;
    accountGuestUserId?: string;
  },
}));
const snapshotState = vi.hoisted(() => ({
  current: null as null | { accountId: string },
}));
const frameInstances = vi.hoisted(() => ({ next: 0 }));
const frameScope = vi.hoisted(() => ({
  context: undefined as import("react").Context<boolean> | undefined,
}));
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
    getThreadMetadata: undefined as undefined | ((threadId: string) => unknown),
    selectThread: vi.fn(),
    createThread: vi.fn(async () => "thread-new"),
    showNotification: vi.fn(),
    threadListLoading: false,
    threadListRevalidating: undefined as boolean | undefined,
    threadListError: false,
    isRemoteThread: vi.fn(() => false),
    events: [],
  },
}));
const settingsOpenRequest = vi.hoisted(() => ({
  current: undefined as undefined | ((tab: string) => void),
}));
const accountOverviewState = vi.hoisted(() => ({
  current: null as null | { user: { user_id: string; apps?: string[] } },
}));

vi.mock("@aomi-labs/react", () => ({
  useAomiRuntime: () => ({
    ...runtimeState.current,
    getThreadMetadata:
      runtimeState.current.getThreadMetadata ??
      ((id: string) => runtimeState.current.threadMetadata.get(id)),
  }),
}));

vi.mock("@aomi-labs/widget/frame", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const Scope = React.createContext(false);
  frameScope.context = Scope;
  return {
    AomiFrame: {
      Root: ({
        accountSessionAvailable,
        applicationId,
        agentTarget,
        children,
        showSidebar,
        persistThread,
        displayPersistence,
      }: {
        accountSessionAvailable: boolean;
        applicationId?: string | null;
        agentTarget?: unknown;
        children?: React.ReactNode;
        showSidebar?: boolean;
        persistThread?: boolean;
        displayPersistence?: string;
      }) => {
        const [instance] = React.useState(() => ++frameInstances.next);
        // Renders children: the real Root mounts the Aomi runtime around
        // them, so anything the portal shell nests here must stay nested.
        return (
          <Scope.Provider value={true}>
            <div
              data-account-session-available={String(accountSessionAvailable)}
              data-application-id={applicationId ?? ""}
              data-agent-target={agentTarget ? JSON.stringify(agentTarget) : ""}
              data-instance={instance}
              data-display-persistence={displayPersistence ?? ""}
              data-show-sidebar={String(showSidebar)}
              data-persist-thread={String(persistThread)}
              data-testid="aomi-frame"
            >
              {children}
            </div>
          </Scope.Provider>
        );
      },
      Header: ({ children }: { children?: React.ReactNode }) => (
        <div>{children}</div>
      ),
      Composer: ({
        controlBarProps,
        sendDisabled,
      }: {
        controlBarProps?: {
          routing?: unknown;
          initialAppTag?: unknown;
          enabledAppIds?: readonly string[];
        };
        sendDisabled?: boolean;
      }) => (
        <div
          data-send-disabled={String(Boolean(sendDisabled))}
          data-routing={JSON.stringify(controlBarProps?.routing)}
          data-app-tag={JSON.stringify(controlBarProps?.initialAppTag ?? null)}
          data-enabled-apps={JSON.stringify(controlBarProps?.enabledAppIds)}
          data-testid="composer"
        />
      ),
    },
  };
});

vi.mock("@/lib/portal-client-options", () => ({
  usePortalClientOptions: () => ({}),
  useRequestedAppConfig: () => requestedAppState.current,
}));

vi.mock("@aomi-labs/widget/host-composition", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    DEFAULT_SIDEBAR_PRODUCTS: [],
    useAomiWalletKit: () => walletKitState.current,
    getBackendUrl: () => backendUrlState.current,
    SvmWalletBindingGate: () => null,
    useAccountSnapshot: () => {
      if (!React.useContext(frameScope.context!))
        throw new Error("Snapshot requires frame scope");
      return [snapshotState.current, vi.fn()];
    },
    HeaderControls: ({
      onOpenSettings,
      showSettings,
    }: {
      onOpenSettings: () => void;
      showSettings: boolean;
    }) =>
      showSettings ? (
        <button type="button" onClick={onOpenSettings}>
          Open settings
        </button>
      ) : null,
    PackagesModal: () => <div data-testid="packages-modal" />,
    SettingsModal: ({ initialTab }: { initialTab?: string }) => (
      <div data-testid="settings-modal" data-tab={initialTab} />
    ),
    useAccountOverview: () => {
      if (!React.useContext(frameScope.context!))
        throw new Error(
          "Portal account display reads require the frame runtime",
        );
      return accountOverviewState.current;
    },
    usePortalWalletAccountMenu: () => undefined,
    // Mirrors the widget: a user, a confirmed guest, nobody, or not known yet.
    useRuntimeAccount: () => {
      const wallet = walletKitState.current;
      if (wallet.isReady === false || wallet.accountStatus === "loading")
        return undefined;
      if (wallet.accountUser)
        return { kind: "user", id: wallet.accountUser.id };
      if (
        wallet.accountStatus === "ready" &&
        wallet.accountGuest &&
        wallet.accountGuestUserId
      )
        return { kind: "guest", id: wallet.accountGuestUserId };
      return null;
    },
    useSettingsOpenRequest: (open: (tab: string) => void) => {
      settingsOpenRequest.current = open;
    },
  };
});

// Renders in place so the assertion below can check where the overlay is
// mounted in the React tree; the real component portals it to <body>.
vi.mock("@/components/shell/overlay-portal", () => ({
  OverlayPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/general/svm-wallet-binding-gate", () => ({
  SvmWalletBindingGate: () => null,
}));

describe("PortalAomiFrame account bootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    snapshotState.current = null;
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
    accountOverviewState.current = null;
    settingsOpenRequest.current = undefined;
    window.history.replaceState({}, "", "/");
    runtimeState.current.currentThreadId = "initial";
    runtimeState.current.threadMetadata = new Map();
    runtimeState.current.getThreadMetadata = undefined;
    runtimeState.current.threadListLoading = false;
    runtimeState.current.threadListRevalidating = undefined;
  });

  it("shows Settings from the scoped snapshot while pending and hides it on sign-out", () => {
    snapshotState.current = { accountId: "acct-a" };
    const view = render(<PortalAomiFrame />);
    expect(screen.getByRole("button", { name: "Open settings" })).toBeVisible();
    walletKitState.current = { accountStatus: "ready" };
    view.rerender(<PortalAomiFrame />);
    expect(
      screen.queryByRole("button", { name: "Open settings" }),
    ).not.toBeInTheDocument();
  });

  it("reads installed apps from the frame's account display cache", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    accountOverviewState.current = {
      user: { user_id: "acct-a", apps: ["default", "uniswap"] },
    };
    render(<PortalAomiFrame />);
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-enabled-apps",
      '["default","uniswap"]',
    );
  });

  it("waits for a booting wallet kit with no account status before validating a saved URL", async () => {
    window.history.replaceState({}, "", "/?thread=saved");
    walletKitState.current = { isReady: false };
    runtimeState.current.currentThreadId = "ephemeral";
    runtimeState.current.threadMetadata = new Map();
    runtimeState.current.threadListLoading = false;
    const view = render(<PortalAomiFrame />);
    const initialInstance = screen.getByTestId("aomi-frame").dataset.instance;
    expect(runtimeState.current.showNotification).not.toHaveBeenCalled();
    expect(runtimeState.current.createThread).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?thread=saved");
    expect(document.querySelector('main[aria-busy="true"]')).not.toBeNull();

    walletKitState.current = {
      isReady: true,
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    runtimeState.current.threadListLoading = true;
    await act(async () => view.rerender(<PortalAomiFrame />));
    expect(runtimeState.current.showNotification).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?thread=saved");

    runtimeState.current.threadMetadata = new Map([
      ["saved", { title: "Saved", status: "regular" }],
    ]);
    runtimeState.current.threadListLoading = false;
    await act(async () => view.rerender(<PortalAomiFrame />));
    expect(runtimeState.current.selectThread).toHaveBeenCalledWith("saved");
    expect(runtimeState.current.showNotification).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?thread=saved");
    expect(screen.getByTestId("aomi-frame").dataset.instance).toBe(
      initialInstance,
    );
  });

  it("keeps the same frame and Send available through initial account restoration", async () => {
    const view = render(<PortalAomiFrame />);

    const initialInstance = screen.getByTestId("aomi-frame").dataset.instance;
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "false",
    );
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
    expect(screen.getByTestId("aomi-frame").dataset.instance).toBe(
      initialInstance,
    );
  });

  it("holds Send for a linked target until account and thread restoration settle", async () => {
    window.history.replaceState({}, "", "/?thread=saved");
    runtimeState.current.threadListLoading = true;
    const view = render(<PortalAomiFrame />);
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "true",
    );
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    await act(async () => view.rerender(<PortalAomiFrame />));
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "true",
    );
    runtimeState.current.currentThreadId = "saved";
    runtimeState.current.threadMetadata = new Map([
      ["saved", { title: "Saved", status: "regular" }],
    ]);
    runtimeState.current.threadListLoading = false;
    await act(async () => view.rerender(<PortalAomiFrame />));
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "false",
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

  it("keeps the Chat shell mounted while the shared account read restores a guest", async () => {
    backendUrlState.current = "/";
    walletKitState.current = { accountStatus: "loading" };
    const fetchSession = vi.fn();
    vi.stubGlobal("fetch", fetchSession);
    const view = render(<PortalAomiFrame />);
    const frame = screen.getByTestId("aomi-frame");
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "false",
    );
    expect(screen.getByTestId("portal-shell")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    walletKitState.current = {
      accountStatus: "ready",
      accountGuest: true,
      accountGuestUserId: "guest-1",
    };
    await act(async () => view.rerender(<PortalAomiFrame />));
    expect(screen.getByTestId("aomi-frame")).toBe(frame);
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "false",
    );
    expect(screen.getByTestId("portal-shell")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    expect(frame).toHaveAttribute("data-account-session-available", "true");
    expect(frame).toHaveAttribute("data-persist-thread", "false");
    expect(frame).toHaveAttribute("data-display-persistence", "account");
    expect(fetchSession).not.toHaveBeenCalled();
  });

  it("unblocks the Chat frame after a failed account read without trusting guest metadata", () => {
    walletKitState.current = {
      accountStatus: "error",
      accountGuest: true,
      accountGuestUserId: "old-guest",
    };
    render(<PortalAomiFrame />);
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "false",
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "false",
    );
  });

  it("does not unlock guest history for metadata without a confirmed guest session", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountGuest: false,
      accountGuestUserId: "other-user",
    };
    render(<PortalAomiFrame />);
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-account-session-available",
      "false",
    );
  });

  it("runs Auto only, with no Direct targets, even with installed apps", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    accountOverviewState.current = {
      user: { user_id: "acct-a", apps: ["default", "credential-demo"] },
    };

    render(<PortalAomiFrame />);

    expect(JSON.parse(screen.getByTestId("composer").dataset.routing!)).toEqual(
      { targets: [{ mode: "auto" }] },
    );
  });

  it("pre-tags an unlocked ?app= link instead of routing it Direct", () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    requestedAppState.current = {
      app: "credential-demo",
      applicationId: "16",
      locked: false,
    };

    render(<PortalAomiFrame />);

    const composer = screen.getByTestId("composer");
    expect(JSON.parse(composer.dataset.routing!)).toEqual({
      targets: [{ mode: "auto" }],
    });
    expect(JSON.parse(composer.dataset.appTag!)).toEqual({
      app: "credential-demo",
      applicationId: 16,
    });
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-agent-target",
      "",
    );
  });

  it("opens Settings on the tab an in-chat control requests", async () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    render(<PortalAomiFrame />);

    await act(async () => {
      settingsOpenRequest.current?.("policy");
    });

    expect(screen.getByTestId("settings-modal")).toHaveAttribute(
      "data-tab",
      "policy",
    );
  });

  it("preserves the shell while sign-in establishes an account scope", async () => {
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

    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
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
  });

  it("preserves the shell while authenticated account scopes change or sign out", async () => {
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
    expect(accountBInstance).toBe(accountAInstance);
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-persist-thread",
      "false",
    );

    walletKitState.current = {
      accountStatus: "ready",
      accountUser: undefined,
    };
    await act(async () => {
      view.rerender(<PortalAomiFrame />);
    });
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-instance",
      accountBInstance,
    );
    expect(screen.getByTestId("aomi-frame")).toHaveAttribute(
      "data-persist-thread",
      "false",
    );
  });

  it("silently drops the old chat URL after account sign-out", async () => {
    walletKitState.current = {
      accountStatus: "ready",
      accountUser: { id: "acct-a" },
    };
    runtimeState.current.currentThreadId = "owned-chat";
    runtimeState.current.threadMetadata = new Map([
      ["owned-chat", { title: "Hello", status: "regular" }],
    ]);
    window.history.replaceState({}, "", "/?thread=owned-chat&app=search");
    const view = render(<PortalAomiFrame />);
    runtimeState.current.showNotification.mockClear();
    runtimeState.current.selectThread.mockClear();
    runtimeState.current.createThread.mockClear();

    walletKitState.current = { accountStatus: "ready" };
    runtimeState.current.currentThreadId = "fresh-guest-chat";
    runtimeState.current.threadMetadata = new Map();
    await act(async () => view.rerender(<PortalAomiFrame />));

    expect(window.location.search).toBe("?app=search");
    expect(runtimeState.current.showNotification).not.toHaveBeenCalled();
    expect(runtimeState.current.selectThread).not.toHaveBeenCalled();
    expect(runtimeState.current.createThread).not.toHaveBeenCalled();
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
      },
    );
    expect(JSON.parse(screen.getByTestId("composer").dataset.appTag!)).toBe(
      null,
    );
  });
});

describe("ThreadUrlBootstrap", () => {
  function RuntimeMessage() {
    const id = useMessage((message) => message.id);
    return <MessagePrimitive.Root>{id}</MessagePrimitive.Root>;
  }

  function RuntimeUrlHarness() {
    const [threadId, setThreadId] = useState("saved");
    const [navigation] = useState(createThreadUrlNavigation);
    const restore = useRef<(text: string) => void>(() => {});
    runtimeState.current = {
      ...runtimeState.current,
      currentThreadId: threadId,
      threadMetadata: new Map([
        ["saved", { title: "Saved", status: "regular" }],
        ["new", { title: "New Chat", status: "regular" }],
      ]),
      isRemoteThread: vi.fn(() => threadId === "saved"),
      selectThread: vi.fn((id: string) => setThreadId(id)),
      createThread: vi.fn(async () => {
        setThreadId("new");
        return "new";
      }),
    };
    return (
      <AssistantRuntimeBoundary
        key={threadId}
        restoreComposerText={restore}
        adapter={{
          messages:
            threadId === "saved"
              ? [
                  {
                    id: "saved-message",
                    role: "user",
                    content: [{ type: "text", text: "Saved conversation" }],
                  },
                ]
              : [],
          convertMessage: (message) => message,
          onNew: vi.fn(),
          adapters: {
            threadList: {
              threadId,
              threads: [{ id: "saved", title: "Saved", status: "regular" }],
              onSwitchToNewThread: () => setThreadId("new"),
              onSwitchToThread: (id: string) => setThreadId(id),
            },
          },
        }}
      >
        <ThreadUrlBootstrap navigation={navigation} />
        <ThreadListPrimitive.New>New chat</ThreadListPrimitive.New>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Messages
            components={{ UserMessage: RuntimeMessage }}
          />
        </ThreadPrimitive.Root>
      </AssistantRuntimeBoundary>
    );
  }

  afterEach(() => {
    window.history.replaceState({}, "", "/");
    runtimeState.current = {
      currentThreadId: "initial",
      threadMetadata: new Map<string, unknown>(),
      getThreadMetadata: undefined,
      selectThread: vi.fn(),
      createThread: vi.fn(async () => "thread-new"),
      showNotification: vi.fn(),
      threadListLoading: false,
      threadListError: false,
      isRemoteThread: vi.fn(() => false),
      events: [],
    };
  });

  it("waits for remote metadata before selecting a linked MCP thread", async () => {
    window.history.replaceState({}, "", "/?thread=mcp-linked");
    runtimeState.current.threadListLoading = true;
    const view = render(<ThreadUrlBootstrap />);
    expect(runtimeState.current.selectThread).not.toHaveBeenCalled();

    runtimeState.current = {
      ...runtimeState.current,
      threadMetadata: new Map([["mcp-linked", {}]]),
      threadListLoading: false,
    };
    await act(async () => {
      view.rerender(<ThreadUrlBootstrap />);
    });

    expect(runtimeState.current.selectThread).toHaveBeenCalledOnce();
    expect(runtimeState.current.selectThread).toHaveBeenCalledWith(
      "mcp-linked",
    );
  });

  it("validates a linked thread against published metadata before the rendered map catches up", () => {
    window.history.replaceState({}, "", "/?thread=published");
    runtimeState.current.threadMetadata = new Map();
    runtimeState.current.getThreadMetadata = () => ({
      title: "Published",
      status: "regular",
    });
    render(<ThreadUrlBootstrap />);
    expect(runtimeState.current.selectThread).toHaveBeenCalledWith("published");
    expect(runtimeState.current.showNotification).not.toHaveBeenCalled();
    expect(runtimeState.current.createThread).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?thread=published");
  });

  it("rejects an actually archived linked thread even when a rendered map still lists it", () => {
    window.history.replaceState({}, "", "/?thread=archived");
    runtimeState.current.threadMetadata = new Map([
      ["archived", { title: "Old", status: "regular" }],
    ]);
    runtimeState.current.getThreadMetadata = () => ({
      title: "Old",
      status: "archived",
    });
    render(<ThreadUrlBootstrap />);
    expect(runtimeState.current.selectThread).not.toHaveBeenCalled();
    expect(runtimeState.current.showNotification).toHaveBeenCalledOnce();
    expect(runtimeState.current.createThread).toHaveBeenCalledOnce();
    expect(window.location.search).toBe("");
  });

  it("clears the saved URL on real New chat and restores messages through browser back and forward", async () => {
    window.history.replaceState({}, "", "/?app=default&thread=saved");
    const push = vi.spyOn(window.history, "pushState");
    render(<RuntimeUrlHarness />);
    expect(screen.getByText("saved-message")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    await waitFor(() => expect(window.location.search).toBe("?app=default"));
    expect(screen.queryByText("saved-message")).not.toBeInTheDocument();

    await act(async () => {
      window.history.back();
    });
    await waitFor(() =>
      expect(screen.getByText("saved-message")).toBeVisible(),
    );
    expect(window.location.search).toBe("?app=default&thread=saved");

    await act(async () => {
      window.history.forward();
    });
    await waitFor(() =>
      expect(screen.queryByText("saved-message")).not.toBeInTheDocument(),
    );
    expect(window.location.search).toBe("?app=default");
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it("waits for live history to validate a URL even when the cached list is visible", () => {
    window.history.replaceState({}, "", "/?thread=saved-chat");
    runtimeState.current.threadListLoading = false;
    runtimeState.current.threadListRevalidating = true;
    const view = render(<ThreadUrlBootstrap />);
    expect(runtimeState.current.createThread).not.toHaveBeenCalled();
    expect(runtimeState.current.selectThread).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?thread=saved-chat");
    runtimeState.current.threadMetadata = new Map([
      ["saved-chat", { title: "Saved", status: "regular" }],
    ]);
    runtimeState.current.threadListRevalidating = false;
    view.rerender(<ThreadUrlBootstrap />);
    expect(runtimeState.current.selectThread).toHaveBeenCalledWith(
      "saved-chat",
    );
  });

  it("does not inspect another account's URL while its session is restoring", () => {
    window.history.replaceState({}, "", "/?thread=account-a-chat");
    render(<ThreadUrlBootstrap ready={false} />);
    expect(runtimeState.current.selectThread).not.toHaveBeenCalled();
    expect(runtimeState.current.showNotification).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?thread=account-a-chat");
  });

  it("does not replace browser navigation when a router render precedes popstate", async () => {
    window.history.replaceState({}, "", "/?app=hoodit&thread=saved");
    runtimeState.current = {
      ...runtimeState.current,
      currentThreadId: "saved",
      threadMetadata: new Map([
        ["saved", { title: "Saved", status: "regular" }],
      ]),
      isRemoteThread: vi.fn(() => true),
    };
    const view = render(<ThreadUrlBootstrap />);
    const push = vi.spyOn(window.history, "pushState");
    window.history.replaceState({}, "", "/?app=hoodit");
    runtimeState.current.threadMetadata = new Map(
      runtimeState.current.threadMetadata,
    );
    view.rerender(<ThreadUrlBootstrap />);
    expect(window.location.search).toBe("?app=hoodit");
    expect(runtimeState.current.createThread).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it.each(["missing", "archived"])(
    "settles an unavailable %s URL on a new chat",
    async (kind) => {
      window.history.replaceState({}, "", "/?app=default&thread=unavailable");
      if (kind === "archived")
        runtimeState.current.threadMetadata = new Map([
          ["unavailable", { status: "archived", title: "Old chat" }],
        ]);
      render(<ThreadUrlBootstrap />);
      expect(runtimeState.current.selectThread).not.toHaveBeenCalled();
      expect(runtimeState.current.createThread).toHaveBeenCalledOnce();
      expect(runtimeState.current.showNotification).toHaveBeenCalledOnce();
      expect(window.location.search).toBe("?app=default");
    },
  );

  it("preserves an established chat URL during repeated submissions", async () => {
    window.history.replaceState({}, "", "/?thread=saved-chat");
    runtimeState.current = {
      ...runtimeState.current,
      currentThreadId: "saved-chat",
      threadMetadata: new Map([
        ["saved-chat", { title: "Saved chat", status: "regular" }],
      ]),
      isRemoteThread: vi.fn(() => true),
    };
    const push = vi.spyOn(window.history, "pushState");
    const view = render(<ThreadUrlBootstrap />);
    runtimeState.current.threadMetadata = new Map([
      ["saved-chat", { title: "Saved chat", status: "regular", pending: true }],
    ]);
    view.rerender(<ThreadUrlBootstrap />);
    runtimeState.current.threadMetadata = new Map([
      [
        "saved-chat",
        { title: "Saved chat", status: "regular", pending: false },
      ],
    ]);
    view.rerender(<ThreadUrlBootstrap />);
    expect(window.location.search).toBe("?thread=saved-chat");
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it("opens a browser-back target once without adding a second history entry", async () => {
    runtimeState.current = {
      ...runtimeState.current,
      currentThreadId: "chat-b",
      threadMetadata: new Map([
        ["chat-a", { title: "A", status: "regular" }],
        ["chat-b", { title: "B", status: "regular" }],
      ]),
      isRemoteThread: vi.fn(() => true),
    };
    window.history.replaceState({}, "", "/?thread=chat-b");
    const view = render(<ThreadUrlBootstrap />);
    const push = vi.spyOn(window.history, "pushState");
    await act(async () => {
      window.history.replaceState({}, "", "/?thread=chat-a");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(runtimeState.current.selectThread).toHaveBeenCalledOnce();
    runtimeState.current.currentThreadId = "chat-a";
    view.rerender(<ThreadUrlBootstrap />);
    expect(window.location.search).toBe("?thread=chat-a");
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });
});
