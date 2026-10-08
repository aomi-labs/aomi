import { useEffect } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ComposerPrimitive } from "@assistant-ui/react";
import { describe, it, expect, vi } from "vitest";
import { AomiRuntimeProvider } from "./aomi-runtime";
import { AomiChatBoundary } from "./assistant-runtime-boundary";
import { useAomiRuntime } from "../interface";
import {
  useThreadContext,
  type ThreadContext,
} from "../contexts/thread-context";
import { useAomiDisplayCache } from "../query/display-cache";
import type { AomiClient, GetAccountBearer } from "@aomi-labs/client";
import type { AomiRuntimeApi } from "../interface";
import { useChatView } from "../state/use-chat-view";
import type { ChatViewStore } from "../state/chat-view-store";

describe("account changes without remounting the shell", () => {
  it("keeps its client and skips the session check once the host confirms a cookie session", async () => {
    let client!: AomiClient;
    function Capture() {
      client = useAomiDisplayCache()!.apiClient!;
      return null;
    }
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path.endsWith("models")) return Response.json(["model"]);
      if (path.endsWith("sessions")) return Response.json({ sessions: [] });
      if (path.endsWith("model-keys")) return Response.json({ keys: [] });
      return Response.json([]);
    });
    const options = { fetch };
    const frame = (confirmed: boolean) => (
      <AomiRuntimeProvider
        backendUrl={window.location.origin}
        clientOptions={options}
        accountSessionAvailable={confirmed}
      >
        <Capture />
      </AomiRuntimeProvider>
    );
    const view = render(frame(false));
    const original = client;
    view.rerender(frame(true));
    expect(client).toBe(original);
    await act(() => client.prepareGuestSession());
    expect(
      fetch.mock.calls.some(([input]) => String(input).includes("/api/auth/")),
    ).toBe(false);
  });
  it("keeps an unsent draft through sign-in, then clears a previous user's views", async () => {
    const mounts = vi.fn();
    let store!: ChatViewStore;
    let threadId = "";
    function Shell() {
      useEffect(() => {
        mounts();
      }, []);
      const runtime = useAomiRuntime();
      threadId = runtime.currentThreadId;
      return <span>Shell</span>;
    }
    function Draft() {
      store = useChatView()!.store;
      return (
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input aria-label="Scoped draft" />
        </ComposerPrimitive.Root>
      );
    }
    const fetch = vi.fn(async (input: string | URL | Request) =>
      Response.json(String(input).endsWith("models") ? ["model"] : []),
    );
    const options = { fetch };
    const frame = (accountId?: string, backendUrl = "https://one.example") => (
      <AomiRuntimeProvider
        backendUrl={backendUrl}
        initialThreadId="original"
        clientOptions={options}
        account={accountId ? { kind: "user", id: accountId } : null}
        displayPersistence="none"
      >
        <Shell />
        <AomiChatBoundary>
          <Draft />
        </AomiChatBoundary>
      </AomiRuntimeProvider>
    );
    const view = render(frame());
    fireEvent.change(screen.getByLabelText("Scoped draft"), {
      target: { value: "draft before sign-in" },
    });
    view.rerender(frame("a"));
    expect(screen.getByLabelText("Scoped draft")).toHaveValue(
      "draft before sign-in",
    );
    expect(threadId).toBe("original");
    store.patch("original", { flags: { expanded: true } });
    view.rerender(frame("b"));
    await waitFor(() =>
      expect(screen.getByLabelText("Scoped draft")).toHaveValue(""),
    );
    expect(threadId).not.toBe("original");
    expect(store.get("original")).toBeUndefined();
    expect(mounts).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Scoped draft"), {
      target: { value: "account b draft" },
    });
    const beforeBackendSwitch = threadId;
    view.rerender(frame("b", "https://two.example"));
    await waitFor(() =>
      expect(screen.getByLabelText("Scoped draft")).toHaveValue(""),
    );
    expect(store.get(beforeBackendSwitch)).toBeUndefined();
    expect(mounts).toHaveBeenCalledOnce();
  });
  it("keeps the chat and draft while a wallet adapter restores the same account", async () => {
    let threadId = "";
    function Shell() {
      threadId = useAomiRuntime().currentThreadId;
      return null;
    }
    function Draft() {
      return (
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input aria-label="Restoring draft" />
        </ComposerPrimitive.Root>
      );
    }
    const options = {
      fetch: vi.fn(async () => Response.json([])),
    };
    const frame = (
      account: { kind: "user"; id: string } | null | undefined,
    ) => (
      <AomiRuntimeProvider
        backendUrl="https://one.example"
        initialThreadId="original"
        clientOptions={options}
        account={account}
        accountSessionAvailable={Boolean(account)}
        displayPersistence="none"
      >
        <Shell />
        <AomiChatBoundary>
          <Draft />
        </AomiChatBoundary>
      </AomiRuntimeProvider>
    );
    const owner = { kind: "user", id: "a" } as const;
    const view = render(frame(owner));
    await waitFor(() => expect(options.fetch).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Restoring draft"), {
      target: { value: "draft before Para" },
    });
    view.rerender(frame(undefined));
    expect(threadId).toBe("original");
    expect(screen.getByLabelText("Restoring draft")).toHaveValue(
      "draft before Para",
    );
    view.rerender(frame(owner));
    expect(threadId).toBe("original");
    expect(screen.getByLabelText("Restoring draft")).toHaveValue(
      "draft before Para",
    );
    view.rerender(frame(undefined));
    view.rerender(frame({ kind: "user", id: "b" }));
    expect(threadId).not.toBe("original");
    expect(screen.getByLabelText("Restoring draft")).toHaveValue("");
    view.rerender(frame(null));
    expect(screen.getByLabelText("Restoring draft")).toHaveValue("");
  });
  it.each([false, true])(
    "sends with the signed-in credential after sign-in (guest chat started=%s), keeping draft and shell",
    async (started) => {
      const mounts = vi.fn();
      let runtime!: AomiRuntimeApi;
      const chats: { sessionId: string; authorization: string | null }[] = [];
      let guestReply!: (response: Response) => void;
      function Shell() {
        runtime = useAomiRuntime();
        useEffect(() => {
          mounts();
        }, []);
        return <span>Shell</span>;
      }
      const completed = (sessionId: string) =>
        Response.json({
          session_id: sessionId,
          cursor: "2",
          events: [
            {
              type: "message",
              sender: "agent",
              content: "signed reply",
              message_key: "answer",
              event_id: "event1",
              sequence: 1,
              turn_id: "turn1",
              occurred_at: 1,
            },
            {
              type: "turn_state_changed",
              state: "complete",
              event_id: "event2",
              sequence: 2,
              turn_id: "turn1",
              occurred_at: 1,
            },
          ],
          has_more: false,
          started_turn_id: "turn1",
        });
      const fetch = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname;
          if (path === "/v1/agent/chat" && init?.method === "POST") {
            const body = JSON.parse(String(init.body)) as { sessionId: string };
            const authorization = new Headers(init.headers).get(
              "authorization",
            );
            chats.push({ sessionId: body.sessionId, authorization });
            if (!authorization) {
              return new Promise<Response>((resolve) => {
                guestReply = resolve;
              });
            }
            return completed(body.sessionId);
          }
          if (path.endsWith("sessions")) return Response.json({ sessions: [] });
          if (path.endsWith("model-keys")) return Response.json({ keys: [] });
          if (path.endsWith("models")) return Response.json(["model"]);
          return Response.json([]);
        },
      );
      const bearer = Object.assign(async () => "signed-wst", {
        required: true,
      }) as GetAccountBearer;
      const guestOptions = { fetch, guest: false as const };
      const signedOptions = { fetch, getAccountBearer: bearer };
      const frame = (signed = false) => (
        <AomiRuntimeProvider
          backendUrl="https://backend.example"
          persistThread={false}
          clientOptions={signed ? signedOptions : guestOptions}
          accountSessionAvailable={signed}
          account={signed ? { kind: "user", id: "signed-account" } : null}
          displayPersistence="none"
        >
          <Shell />
          <AomiChatBoundary>
            <ComposerPrimitive.Root>
              <ComposerPrimitive.Input aria-label="Sign-in draft" />
            </ComposerPrimitive.Root>
          </AomiChatBoundary>
        </AomiRuntimeProvider>
      );
      const view = render(frame());
      const initialThread = runtime.currentThreadId;
      let oldSend: Promise<void> | undefined;
      if (started) {
        act(() => {
          oldSend = runtime
            .sendMessage("old guest request")
            .catch(() => undefined);
        });
        await waitFor(() => expect(chats).toHaveLength(1));
      }
      fireEvent.change(screen.getByLabelText("Sign-in draft"), {
        target: { value: "unsent draft" },
      });
      view.rerender(frame(true));
      await waitFor(() =>
        expect(screen.getByLabelText("Sign-in draft")).toHaveValue(
          "unsent draft",
        ),
      );
      const nextThread = runtime.currentThreadId;
      expect(nextThread === initialThread).toBe(!started);
      expect(mounts).toHaveBeenCalledOnce();
      if (started) {
        await act(async () => {
          guestReply(completed(initialThread));
          await oldSend;
        });
        expect(runtime.events).toHaveLength(0);
      }
      await act(() => runtime.sendMessage("signed prompt"));
      expect(chats.at(-1)).toEqual({
        sessionId: nextThread,
        authorization: "Bearer signed-wst",
      });
      expect(
        runtime.events.some(
          (event) =>
            event.type === "message" && event.content === "signed reply",
        ),
      ).toBe(true);
      expect(mounts).toHaveBeenCalledOnce();
    },
  );
  it("selects a chat added after the select callback was created", async () => {
    let runtime!: AomiRuntimeApi;
    let threads!: ThreadContext;
    function Capture() {
      const currentRuntime = useAomiRuntime();
      const currentThreads = useThreadContext();
      useEffect(() => {
        runtime = currentRuntime;
        threads = currentThreads;
      }, [currentRuntime, currentThreads]);
      return null;
    }
    const fetch = vi.fn(async () => Response.json([]));
    render(
      <AomiRuntimeProvider
        backendUrl="https://backend.example"
        clientOptions={{ fetch, guest: false }}
        persistThread={false}
      >
        <Capture />
      </AomiRuntimeProvider>,
    );
    const select = runtime.selectThread;
    await act(() =>
      threads.setThreadMetadata((previous) =>
        new Map(previous).set("published", {
          title: "Published",
          status: "regular",
          control: {
            model: null,
            app: null,
            applicationId: null,
            controlDirty: false,
          },
        }),
      ),
    );
    act(() => select("published"));
    expect(runtime.currentThreadId).toBe("published");
    expect(threads.getThreadMetadata("published")?.title).toBe("Published");
  });
  it("keeps a running cookie turn when the account resolves after the send", async () => {
    let runtime!: AomiRuntimeApi;
    let acknowledge!: (response: Response) => void;
    const paths: string[] = [];
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname;
        paths.push(path);
        if (path === "/api/auth/get-session") {
          expect(init?.credentials).toBe("include");
          return Response.json({
            session: { id: "cookie-session" },
            user: { id: "signed-account" },
          });
        }
        if (path === "/v1/agent/chat" && init?.method === "POST")
          return new Promise<Response>((resolve) => {
            acknowledge = resolve;
          });
        if (path.endsWith("sessions")) return Response.json({ sessions: [] });
        if (path.endsWith("model-keys")) return Response.json({ keys: [] });
        return Response.json([]);
      },
    );
    const options = { fetch };
    function Capture() {
      runtime = useAomiRuntime();
      return null;
    }
    const frame = (resolved = false) => (
      <AomiRuntimeProvider
        backendUrl={window.location.origin}
        persistThread={false}
        clientOptions={resolved ? { ...options } : options}
        accountSessionAvailable={resolved}
        account={resolved ? { kind: "user", id: "signed-account" } : null}
        displayPersistence="none"
      >
        <Capture />
      </AomiRuntimeProvider>
    );
    const view = render(frame());
    const initialThread = runtime.currentThreadId;
    let sent!: Promise<void>;
    act(() => {
      sent = runtime.sendMessage("signed cookie prompt");
    });
    await waitFor(() => expect(paths).toContain("/v1/agent/chat"));
    view.rerender(frame(true));
    expect(runtime.currentThreadId).toBe(initialThread);
    await act(async () => {
      acknowledge(
        Response.json({
          session_id: initialThread,
          cursor: "2",
          has_more: false,
          started_turn_id: "turn1",
          events: [
            {
              type: "message",
              sender: "agent",
              content: "existing signed reply",
              message_key: "answer",
              event_id: "event1",
              sequence: 1,
              turn_id: "turn1",
              occurred_at: 1,
            },
            {
              type: "turn_state_changed",
              state: "complete",
              event_id: "event2",
              sequence: 2,
              turn_id: "turn1",
              occurred_at: 1,
            },
          ],
        }),
      );
      await sent;
    });
    expect(
      runtime.events.some(
        (event) =>
          event.type === "message" && event.content === "existing signed reply",
      ),
    ).toBe(true);
    expect(paths.filter((path) => path === "/v1/agent/chat")).toHaveLength(1);
    expect(paths.some((path) => path.includes("anonymous"))).toBe(false);
  });
  it.each(["guest-a", "account-b"])(
    "closes the guest's chat unless the cookie guest becomes the same user (%s)",
    async (signedInUser) => {
      let runtime!: AomiRuntimeApi;
      let threadContext!: ThreadContext;
      let store!: ChatViewStore;
      let acknowledge!: (response: Response) => void;
      const mounts = vi.fn();
      const requests: { sessionId: string; subject: string }[] = [];
      let cookieSubject = "guest-a";
      const reply = (sessionId: string, content: string) =>
        Response.json({
          session_id: sessionId,
          cursor: "2",
          has_more: false,
          started_turn_id: "turn1",
          events: [
            {
              type: "message",
              sender: "agent",
              content,
              message_key: "answer",
              event_id: "event1",
              sequence: 1,
              turn_id: "turn1",
              occurred_at: 1,
            },
            {
              type: "turn_state_changed",
              state: "complete",
              event_id: "event2",
              sequence: 2,
              turn_id: "turn1",
              occurred_at: 1,
            },
          ],
        });
      const fetch = vi.fn(
        async (input: string | URL | Request, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname;
          if (path === "/api/auth/get-session")
            return Response.json({
              session: { id: "anonymous-cookie" },
              user: { id: cookieSubject, isAnonymous: true },
            });
          if (path === "/v1/agent/chat" && init?.method === "POST") {
            const { sessionId } = JSON.parse(String(init.body)) as {
              sessionId: string;
            };
            expect(new Headers(init.headers).has("authorization")).toBe(false);
            requests.push({ sessionId, subject: cookieSubject });
            if (requests.length === 1)
              return new Promise<Response>((resolve) => {
                acknowledge = resolve;
              });
            return reply(sessionId, "signed-in reply");
          }
          if (path.endsWith("sessions")) return Response.json({ sessions: [] });
          if (path.endsWith("model-keys")) return Response.json({ keys: [] });
          return Response.json([]);
        },
      );
      const options = { fetch };
      function Capture() {
        const currentRuntime = useAomiRuntime();
        const currentThreads = useThreadContext();
        useEffect(() => {
          runtime = currentRuntime;
          threadContext = currentThreads;
        }, [currentRuntime, currentThreads]);
        useEffect(() => {
          mounts();
        }, []);
        return null;
      }
      function Composer() {
        const view = useChatView()!;
        useEffect(() => {
          store = view.store;
        }, [view.store]);
        return (
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input aria-label="Cookie transition draft" />
          </ComposerPrimitive.Root>
        );
      }
      const frame = (signed = false) => (
        <AomiRuntimeProvider
          backendUrl={window.location.origin}
          persistThread={false}
          clientOptions={options}
          accountSessionAvailable
          account={
            signed
              ? { kind: "user", id: signedInUser }
              : { kind: "guest", id: "guest-a" }
          }
          displayPersistence="none"
        >
          <Capture />
          <AomiChatBoundary>
            <Composer />
          </AomiChatBoundary>
        </AomiRuntimeProvider>
      );
      const view = render(frame());
      const previousThread = runtime.currentThreadId;
      let pending!: Promise<void>;
      act(() => {
        pending = runtime
          .sendMessage("anonymous request")
          .catch(() => undefined);
      });
      await waitFor(() => expect(requests).toHaveLength(1));
      store.patch(previousThread, { flags: { expanded: true } });
      fireEvent.change(screen.getByLabelText("Cookie transition draft"), {
        target: { value: "keep this unsent draft" },
      });
      cookieSubject = signedInUser;
      view.rerender(frame(true));
      const sameOwner = signedInUser === "guest-a";
      expect(runtime.currentThreadId === previousThread).toBe(sameOwner);
      await waitFor(() =>
        expect(screen.getByLabelText("Cookie transition draft")).toHaveValue(
          "keep this unsent draft",
        ),
      );
      expect(mounts).toHaveBeenCalledOnce();
      if (!sameOwner) expect(store.get(previousThread)).toBeUndefined();
      await act(async () => {
        acknowledge(reply(previousThread, "old anonymous reply"));
        await pending;
      });
      expect(
        runtime.events.some(
          (event) =>
            event.type === "message" && event.content === "old anonymous reply",
        ),
      ).toBe(sameOwner);
      if (!sameOwner) {
        expect(store.get(previousThread)).toBeUndefined();
        expect(threadContext.getThreadMetadata(previousThread)).toBeUndefined();
      }
      await act(() => runtime.sendMessage("signed-in request"));
      expect(requests.at(-1)).toEqual({
        sessionId: runtime.currentThreadId,
        subject: signedInUser,
      });
      expect(requests.at(-1)!.sessionId === requests[0].sessionId).toBe(
        sameOwner,
      );
      expect(mounts).toHaveBeenCalledOnce();
    },
  );
  it("still saves the draft of an empty chat after a guest signs in from it", async () => {
    let runtime!: AomiRuntimeApi;
    let threads!: ThreadContext;
    function Shell() {
      runtime = useAomiRuntime();
      threads = useThreadContext();
      return null;
    }
    const fetch = vi.fn(async (input: string | URL | Request) =>
      Response.json(String(input).endsWith("models") ? ["model"] : []),
    );
    const bearer = Object.assign(async () => "signed-wst", {
      required: true,
    }) as GetAccountBearer;
    const guestOptions = { fetch, guest: false as const };
    const signedOptions = { fetch, getAccountBearer: bearer };
    const frame = (signed: boolean) => (
      <AomiRuntimeProvider
        backendUrl="https://backend.example"
        persistThread={false}
        clientOptions={signed ? signedOptions : guestOptions}
        account={signed ? { kind: "user", id: "user" } : null}
        displayPersistence="none"
      >
        <Shell />
        <AomiChatBoundary>
          <ComposerPrimitive.Root>
            <ComposerPrimitive.Input aria-label="Draft" />
          </ComposerPrimitive.Root>
        </AomiChatBoundary>
      </AomiRuntimeProvider>
    );
    const view = render(frame(false));
    const chat = runtime.currentThreadId;
    view.rerender(frame(true));
    expect(runtime.currentThreadId).toBe(chat);
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "typed after sign-in" },
    });
    act(() => threads.setCurrentThreadId("other"));
    expect(screen.getByLabelText("Draft")).toHaveValue("");
    act(() => threads.setCurrentThreadId(chat));
    await waitFor(() =>
      expect(screen.getByLabelText("Draft")).toHaveValue("typed after sign-in"),
    );
  });
});
