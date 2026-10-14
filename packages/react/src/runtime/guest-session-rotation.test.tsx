import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AomiClient, createGuestSessionProvider } from "@aomi-labs/client";
import { FakeAgentBackend } from "../../../../tests/e2e/fake-backend/backend";
import {
  ThreadContextProvider,
  useThreadContext,
  type ThreadContext,
} from "../contexts/thread-context";
import { useRuntimeOrchestrator } from "./orchestrator";

afterEach(() => vi.unstubAllGlobals());

describe("expired guest sessions", () => {
  it.each(["new", "existing", "confirmed"] as const)(
    "sends the prompt again in a fresh chat when a %s same-origin cookie guest expires",
    async (initial) => {
      const origin = "https://chat.aomi.dev";
      vi.stubGlobal("location", { origin });
      const backend = new FakeAgentBackend();
      let subject = initial === "new" ? 0 : 1;
      let cookie: string | null = initial === "new" ? null : "guest-1";
      let expired = false;
      const owners = new Map<string, string>();
      const posts: { id: string; cookie: string; status: number }[] = [];
      const fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        if (url.pathname === "/api/auth/get-session")
          return Response.json(
            cookie
              ? {
                  session: { id: `cookie-${subject}` },
                  user: { id: cookie, isAnonymous: true },
                }
              : null,
          );
        if (url.pathname === "/api/auth/sign-in/anonymous") {
          expect(init?.credentials).toBe("include");
          cookie = `guest-${++subject}`;
          return Response.json({
            session: { id: `cookie-${subject}` },
            user: { id: cookie, isAnonymous: true },
          });
        }
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (url.pathname === "/v1/agent/chat" && init?.method === "POST") {
          expect(headers.has("authorization")).toBe(false);
          const id: string = body.sessionId;
          const status =
            !cookie || (expired && cookie === "guest-1")
              ? 401
              : owners.has(id) && owners.get(id) !== cookie
                ? 404
                : 200;
          posts.push({ id, cookie: cookie ?? "", status });
          if (status !== 200)
            return Response.json(
              {
                error: {
                  code: status === 401 ? "invalid_token" : "session_not_found",
                },
              },
              { status },
            );
          owners.set(id, cookie!);
        }
        const result = await backend.handle({
          method: init?.method ?? "GET",
          url,
          headers: Object.fromEntries(headers),
          body,
        });
        if (result.kind !== "json")
          throw new Error("Expected a completed turn");
        return Response.json(result.body, { status: result.status });
      };
      const client = new AomiClient({
        baseUrl: origin,
        fetch,
        guest: createGuestSessionProvider({
          baseUrl: origin,
          fetch,
          getCookieSessionAvailable: () => initial === "confirmed",
        }),
      });
      let runtime!: ReturnType<typeof useRuntimeOrchestrator>;
      let threads!: ThreadContext;
      function Capture() {
        threads = useThreadContext();
        runtime = useRuntimeOrchestrator(client, {
          getUserState: () => ({}),
          getTarget: () => ({ mode: "auto" }),
        });
        return null;
      }
      const view = render(
        <ThreadContextProvider initialThreadId="old-cookie-chat">
          <Capture />
        </ThreadContextProvider>,
      );
      await act(() =>
        runtime.sendMessage("original cookie prompt", "old-cookie-chat"),
      );
      expired = true;
      await act(() =>
        runtime.sendMessage("renewed cookie prompt", "old-cookie-chat"),
      );
      const freshId = threads.currentThreadId;
      expect(freshId).not.toBe("old-cookie-chat");
      expect(posts).toEqual([
        { id: "old-cookie-chat", cookie: "guest-1", status: 200 },
        { id: "old-cookie-chat", cookie: "guest-1", status: 401 },
        { id: freshId, cookie: "guest-2", status: 200 },
      ]);
      expect(owners.get("old-cookie-chat")).toBe("guest-1");
      expect(owners.get(freshId)).toBe("guest-2");
      expect(runtime.sessionManager.get("old-cookie-chat")).toBeUndefined();
      expect(threads.allThreadsMetadata.size).toBe(1);
      expect(JSON.stringify(runtime.snapshot.events)).toContain(
        "renewed cookie prompt",
      );
      expect(JSON.stringify(runtime.snapshot.events)).not.toContain(
        "original cookie prompt",
      );
      expect(subject).toBe(2);
      view.unmount();
    },
  );

  it.each([false, true])(
    "keeps the old chat with the old guest and retries once in a fresh chat (fresh request rejected=%s)",
    async (rejectFresh) => {
      const backend = new FakeAgentBackend();
      let subject = 0;
      let expired = false;
      const owners = new Map<string, string>();
      const posts: { id: string; token: string; status: number }[] = [];
      const fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/auth/widget/guest")
          return Response.json({
            access_token: `aomi_wst_${++subject}`,
            user: { id: `guest-${subject}` },
          });
        const headers = new Headers(init?.headers);
        const token = headers.get("authorization")!;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (url.pathname === "/v1/agent/chat" && init?.method === "POST") {
          const id: string = body.sessionId;
          const status =
            expired && (token === "Bearer aomi_wst_1" || rejectFresh)
              ? 401
              : 200;
          posts.push({ id, token, status });
          if (status === 401)
            return Response.json(
              { error: { code: "invalid_token" } },
              { status },
            );
          if (owners.has(id) && owners.get(id) !== token)
            return Response.json(
              { error: { code: "session_not_found" } },
              { status: 404 },
            );
          owners.set(id, token);
        }
        const result = await backend.handle({
          method: init?.method ?? "GET",
          url,
          headers: Object.fromEntries(headers),
          body,
        });
        if (result.kind !== "json")
          throw new Error("Completed fixture should not open a stream");
        return Response.json(result.body, { status: result.status });
      };
      const client = new AomiClient({
        baseUrl: "https://guest-api.example",
        fetch,
      });
      let runtime!: ReturnType<typeof useRuntimeOrchestrator>;
      let threads!: ThreadContext;
      const rotated = vi.fn();
      function Capture() {
        threads = useThreadContext();
        runtime = useRuntimeOrchestrator(client, {
          getUserState: () => ({}),
          getTarget: () => ({ mode: "auto" }),
          onGuestExpired: rotated,
        });
        return null;
      }
      const view = render(
        <ThreadContextProvider initialThreadId="old-chat">
          <Capture />
        </ThreadContextProvider>,
      );
      const control = {
        model: "chosen-model",
        modelMode: "manual" as const,
        app: null,
        applicationId: null,
        controlDirty: false,
      };
      act(() => threads.updateThreadMetadata("old-chat", { control }));
      await act(() =>
        runtime.sendMessage("original anonymous conversation", "old-chat"),
      );
      const originalEvents = runtime.snapshot.events;
      expect(originalEvents.length).toBeGreaterThan(0);
      expired = true;
      if (rejectFresh)
        await act(async () => {
          await expect(
            runtime.sendMessage("renewed anonymous prompt", "old-chat"),
          ).rejects.toMatchObject({ code: "guest_identity_changed" });
        });
      else
        await act(() =>
          runtime.sendMessage("renewed anonymous prompt", "old-chat"),
        );
      const newId = threads.currentThreadId;
      expect(newId).not.toBe("old-chat");
      expect(posts).toEqual([
        { id: "old-chat", token: "Bearer aomi_wst_1", status: 200 },
        { id: "old-chat", token: "Bearer aomi_wst_1", status: 401 },
        {
          id: newId,
          token: "Bearer aomi_wst_2",
          status: rejectFresh ? 401 : 200,
        },
      ]);
      expect(owners.get("old-chat")).toBe("Bearer aomi_wst_1");
      expect(owners.get(newId)).toBe(
        rejectFresh ? undefined : "Bearer aomi_wst_2",
      );
      expect(threads.allThreadsMetadata.size).toBe(1);
      expect(threads.getThreadMetadata(newId)?.control).toEqual(control);
      expect(rotated).toHaveBeenCalledOnce();
      expect(runtime.sessionManager.get("old-chat")).toBeUndefined();
      if (!rejectFresh)
        expect(JSON.stringify(runtime.snapshot.events)).toContain(
          "renewed anonymous prompt",
        );
      expect(JSON.stringify(runtime.snapshot.events)).not.toContain(
        "original anonymous conversation",
      );
      expect(subject).toBe(rejectFresh ? 3 : 2);
      view.unmount();
    },
  );

  it("does not treat a signed-in error code as an expired guest", async () => {
    const posts: string[] = [];
    const client = new AomiClient({
      baseUrl: "https://signed-api.example",
      guest: false,
      getAccountBearer: Object.assign(async () => "signed-token", {
        required: true as const,
      }),
      fetch: async (input) => {
        posts.push(String(input));
        return Response.json(
          { error: { code: "guest_identity_changed" } },
          { status: 401 },
        );
      },
    });
    let runtime!: ReturnType<typeof useRuntimeOrchestrator>;
    let threads!: ThreadContext;
    function Capture() {
      threads = useThreadContext();
      runtime = useRuntimeOrchestrator(client, {
        getUserState: () => ({}),
        getTarget: () => ({ mode: "auto" }),
      });
      return null;
    }
    const view = render(
      <ThreadContextProvider initialThreadId="signed-chat">
        <Capture />
      </ThreadContextProvider>,
    );
    await act(async () => {
      await expect(
        runtime.sendMessage("signed request", "signed-chat"),
      ).rejects.toMatchObject({
        code: "guest_identity_changed",
        isGuestIdentityChanged: false,
      });
    });
    expect(threads.currentThreadId).toBe("signed-chat");
    expect(posts).toHaveLength(2);
    view.unmount();
  });
});
