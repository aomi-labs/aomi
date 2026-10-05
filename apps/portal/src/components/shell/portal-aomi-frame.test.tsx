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
    showNotification: vi.fn(),
    threadListLoading: false,
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
  useAomiRuntime: () => runtimeState.current,
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
        sendDisabled,
      }: {
        controlBarProps?: { routing?: unknown; initialAppTag?: unknown };
        sendDisabled?: boolean;
      }) => (
        <div
          data-send-disabled={String(Boolean(sendDisabled))}
          data-routing={JSON.stringify(controlBarProps?.routing)}
          data-app-tag={JSON.stringify(controlBarProps?.initialAppTag ?? null)}
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
  SettingsModal: ({ initialTab }: { initialTab?: string }) => (
    <div data-testid="settings-modal" data-tab={initialTab} />
  ),
  useAccountOverview: () => accountOverviewState.current,
  usePortalWalletAccountMenu: () => undefined,
  useSettingsOpenRequest: (open: (tab: string) => void) => {
    settingsOpenRequest.current = open;
  },
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
    accountOverviewState.current = null;
    settingsOpenRequest.current = undefined;
  });

  it("keeps the same frame mounted, holding send, through initial account restoration", async () => {
    const view = render(<PortalAomiFrame />);

    const initialInstance = screen.getByTestId("aomi-frame").dataset.instance;
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "true",
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
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "true",
    );
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
      expect(screen.getByTestId("composer")).toHaveAttribute(
        "data-send-disabled",
        "false",
      ),
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
    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "true",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(screen.getByTestId("composer")).toHaveAttribute(
      "data-send-disabled",
      "false",
    );
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
