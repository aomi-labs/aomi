import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionSafetyPolicy } from "@aomi-labs/client";

const state = vi.hoisted(() => ({
  request: vi.fn(),
  runtime: { currentThreadId: "chat-a", events: [{}] as unknown[] },
  walletKit: { accountUser: { id: "acct" } as { id: string } | undefined },
  account: undefined as unknown,
  thread: undefined as unknown,
}));
vi.mock("@aomi-labs/react", async (original) => ({
  ...(await original<typeof import("@aomi-labs/react")>()),
  useOptionalAomiRuntime: () => state.runtime,
}));
vi.mock("@/lib/wallet-kit", () => ({
  useAomiWalletKit: () => state.walletKit,
}));
vi.mock("@/components/account-shell/transport", () => ({
  useShellTransport: () => ({ json: state.request }),
}));

import { useState } from "react";
import { saveTransactionSafety } from "@/components/account-shell/features/policy/transaction-safety-api";
import {
  SafetySelect,
  ThreadSafetyProvider,
  useThreadSafety,
} from "./safety-select";

/** Mirrors the composer's send path: a held level is saved before sending. */
function SendProbe() {
  const safety = useThreadSafety();
  const [result, setResult] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (!safety?.hasHeld()) return setResult("sent");
          void safety
            .commitHeld()
            .then((saved) => setResult(saved ? "sent" : "blocked"));
        }}
      >
        Send
      </button>
      <span data-testid="sent">{result}</span>
      <span data-testid="error">{safety?.error}</span>
    </>
  );
}

const policy = (
  mode: TransactionSafetyPolicy["mode"],
  revision: number,
  scope: TransactionSafetyPolicy["scope"],
): TransactionSafetyPolicy => ({
  mode,
  revision,
  scope,
  source: scope === "thread" ? "user" : "default",
});

function puts() {
  return state.request.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
  );
}

const trigger = () => screen.findByRole("combobox", { name: /Guard policy/ });

beforeEach(() => {
  state.runtime = { currentThreadId: "chat-a", events: [{}] };
  state.walletKit = { accountUser: { id: "acct" } };
  state.account = policy("balanced", 1, "account_default");
  state.thread = policy("balanced", 3, "thread");
  state.request
    .mockReset()
    .mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          mode: TransactionSafetyPolicy["mode"];
          expectedRevision: number;
        };
        state.thread = policy(body.mode, body.expectedRevision + 1, "thread");
        return Promise.resolve(state.thread);
      }
      return Promise.resolve(
        path === "/api/thread/transaction-safety"
          ? state.thread
          : state.account,
      );
    });
});
afterEach(cleanup);

describe("SafetySelect", () => {
  it("shows the default, disabled, without a signed-in account", async () => {
    state.walletKit = { accountUser: undefined };
    render(<SafetySelect />);
    await act(async () => {});
    const shown = screen.getByRole("button", {
      name: "Guard policy: Balanced",
    });
    expect(shown).toHaveAttribute("aria-disabled", "true");
    expect(shown).toHaveAttribute(
      "title",
      "Sign in to change the guard policy",
    );
    fireEvent.click(shown);
    expect(screen.queryByText("Guard policy")).toBeNull();
    expect(state.request).not.toHaveBeenCalled();
  });

  it("renders the remembered default before the account answers", async () => {
    // Only a chat that hasn't started inherits the account default.
    state.runtime = { currentThreadId: "draft", events: [] };
    window.localStorage.setItem(
      "aomi:transaction-safety-default",
      "guarded_only",
    );
    const pending: Array<() => void> = [];
    state.request.mockImplementation(
      (path: string) =>
        new Promise((resolve) =>
          pending.push(() =>
            resolve(
              path === "/api/thread/transaction-safety"
                ? state.thread
                : policy("balanced", 1, "account_default"),
            ),
          ),
        ),
    );
    render(<SafetySelect />);
    expect(
      screen.getByRole("button", { name: "Guard policy: Strict" }),
    ).toHaveAttribute("aria-disabled", "true");

    await act(async () => pending.forEach((answer) => answer()));
    await waitFor(() =>
      expect(
        window.localStorage.getItem("aomi:transaction-safety-default"),
      ).toBe("balanced"),
    );
    window.localStorage.removeItem("aomi:transaction-safety-default");
  });

  it("quietly shows the account default while a started chat's level loads", async () => {
    state.runtime = { currentThreadId: "chat-unseen", events: [{}] };
    state.thread = policy("unrestricted", 4, "thread");
    let answerThread: (() => void) | undefined;
    const request = state.request.getMockImplementation()!;
    state.request.mockImplementation((path: string, init?: RequestInit) =>
      path === "/api/thread/transaction-safety"
        ? new Promise((resolve) => {
            answerThread = () => resolve(state.thread);
          })
        : request(path, init),
    );
    render(<SafetySelect />);
    await act(async () => {});

    const loading = screen.getByRole("button", {
      name: "Guard policy: Balanced",
    });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("aria-disabled", "true");

    await act(async () => answerThread!());
    const yolo = await trigger();
    expect(yolo.textContent).toBe("Yolo");
    expect(yolo.className).toContain("text-aomi-danger");
  });

  it("names a failed load on the trigger and retries it from the menu", async () => {
    state.thread = policy("unrestricted", 4, "thread");
    const request = state.request.getMockImplementation()!;
    state.request.mockImplementation((path: string, init?: RequestInit) =>
      path === "/api/thread/transaction-safety"
        ? Promise.reject(new Error("backend down"))
        : request(path, init),
    );
    render(<SafetySelect />);

    const failed = await screen.findByRole("combobox", {
      name: "Guard policy: Unavailable",
    });
    expect(failed.textContent).toBe("Unavailable");
    fireEvent.click(failed);
    expect(screen.getByRole("alert")).toHaveTextContent("backend down");
    expect(screen.queryByRole("button", { name: /Strict/ })).toBeNull();

    state.request.mockImplementation(request);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await waitFor(async () =>
      expect((await trigger()).textContent).toBe("Yolo"),
    );
  });

  it("lists the three levels and the account default", async () => {
    render(<SafetySelect />);
    fireEvent.click(await trigger());

    expect(screen.getByText("Guard policy")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Strict.*protocol guard covers/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Balanced.*critical guard/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /Yolo.*guards flag it/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("New chats start on Balanced")).toBeInTheDocument();
  });

  it("names the chat's level on the trigger, including the default", async () => {
    const view = render(<SafetySelect />);
    await waitFor(async () =>
      expect((await trigger()).textContent).toBe("Balanced"),
    );

    state.thread = policy("guarded_only", 4, "thread");
    state.runtime = { currentThreadId: "chat-b", events: [{}] };
    view.rerender(<SafetySelect />);
    await waitFor(async () =>
      expect((await trigger()).textContent).toBe("Strict"),
    );
  });

  it("follows a new default saved from Settings", async () => {
    state.thread = policy("guarded_only", 4, "thread");
    render(<SafetySelect />);
    await waitFor(async () =>
      expect((await trigger()).textContent).toBe("Strict"),
    );

    fireEvent.click(await trigger());
    expect(
      await screen.findByText("New chats start on Balanced"),
    ).toBeInTheDocument();

    // Only the save event can move the footer: the account GET still answers
    // Balanced.
    await act(() => saveTransactionSafety(state.request, "guarded_only", 1));
    expect(
      await screen.findByText("New chats start on Strict"),
    ).toBeInTheDocument();
  });

  it("saves a level for the open chat with its revision", async () => {
    render(<SafetySelect />);
    fireEvent.click(await trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Strict/ }));
    });

    expect(puts()).toEqual([
      [
        "/api/thread/transaction-safety",
        expect.objectContaining({
          headers: { "X-Thread-Id": "chat-a", "X-Session-Id": "chat-a" },
          body: JSON.stringify({ mode: "guarded_only", expectedRevision: 3 }),
        }),
      ],
    ]);
    await waitFor(async () =>
      expect((await trigger()).textContent).toBe("Strict"),
    );
  });

  it("asks once, inline, before turning on Yolo", async () => {
    render(<SafetySelect />);
    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole("button", { name: /Yolo/ }));

    expect(screen.getByText("Turn on Yolo for this chat?")).toBeInTheDocument();
    expect(puts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Guard policy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Yolo/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    });

    expect(puts()).toHaveLength(1);
    expect(JSON.parse(String(puts()[0]![1].body))).toEqual({
      mode: "unrestricted",
      expectedRevision: 3,
    });
    const yolo = await trigger();
    await waitFor(() => expect(yolo.textContent).toBe("Yolo"));
    expect(yolo.className).toContain("text-aomi-danger");
  });

  it("locks the level until the chat starts when no send path can wait", async () => {
    state.runtime = { currentThreadId: "draft", events: [] };
    render(<SafetySelect />);
    fireEvent.click(await trigger());

    expect(
      screen.getByText("Set after your first message"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Strict/ })).toBeDisabled();
  });

  it("saves a new chat's held level before its first send", async () => {
    state.runtime = { currentThreadId: "draft", events: [] };
    // The backend reads an unsent chat as the account default snapshot.
    state.thread = policy("balanced", 1, "thread");
    render(
      <ThreadSafetyProvider>
        <SafetySelect />
        <SendProbe />
      </ThreadSafetyProvider>,
    );
    fireEvent.click(await trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Strict/ }));
    });

    expect(puts()).toHaveLength(0);
    expect((await trigger()).textContent).toBe("Strict");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    expect(screen.getByTestId("sent")).toHaveTextContent("sent");
    expect(puts()).toEqual([
      [
        "/api/thread/transaction-safety",
        expect.objectContaining({
          headers: { "X-Thread-Id": "draft", "X-Session-Id": "draft" },
          body: JSON.stringify({ mode: "guarded_only", expectedRevision: 1 }),
        }),
      ],
    ]);
  });

  it("joins a first send already saving the held level", async () => {
    state.runtime = { currentThreadId: "draft", events: [] };
    state.thread = policy("balanced", 1, "thread");
    let answerPut: (() => void) | undefined;
    const request = state.request.getMockImplementation()!;
    state.request.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Promise((resolve) => {
            answerPut = () => resolve(request(path, init));
          })
        : request(path, init),
    );
    render(
      <ThreadSafetyProvider>
        <SafetySelect />
        <SendProbe />
      </ThreadSafetyProvider>,
    );
    fireEvent.click(await trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Strict/ }));
    });
    const threadReads = () =>
      state.request.mock.calls.filter(
        ([path, init]) =>
          path === "/api/thread/transaction-safety" &&
          (init as RequestInit | undefined)?.method !== "PUT",
      ).length;
    const readsBefore = threadReads();

    // Enter, then the form's own resubmit, while the save is in flight.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });
    await act(async () => answerPut!());

    expect(screen.getByTestId("sent")).toHaveTextContent("sent");
    expect(puts()).toHaveLength(1);
    expect(threadReads() - readsBefore).toBe(1);
  });

  it("blocks the first send when the held level cannot be saved", async () => {
    state.runtime = { currentThreadId: "draft", events: [] };
    state.thread = policy("balanced", 1, "thread");
    const request = state.request.getMockImplementation()!;
    state.request.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? Promise.reject(new Error("conflict"))
        : request(path, init),
    );
    render(
      <ThreadSafetyProvider>
        <SafetySelect />
        <SendProbe />
      </ThreadSafetyProvider>,
    );
    fireEvent.click(await trigger());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Strict/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    expect(screen.getByTestId("sent")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "Message not sent. conflict",
    );
  });

  it("opens Settings on the Safety tab from Change", async () => {
    const opened = vi.fn();
    const listener = (event: Event) =>
      opened((event as CustomEvent<string>).detail);
    window.addEventListener("aomi:open-settings", listener);
    render(<SafetySelect />);
    fireEvent.click(await trigger());
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    window.removeEventListener("aomi:open-settings", listener);

    expect(opened).toHaveBeenCalledWith("policy");
  });
});
