import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  useMessage,
  useComposerRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  AomiRuntimeApiProvider,
  useOptionalAomiRuntime,
  type AomiRuntimeApi,
} from "@aomi-labs/react";
import { AomiFrame } from "@/frame/aomi-frame";
import { testIds } from "@/test-ids";
import type { PendingInput } from "@aomi-labs/client";

const work = vi.hoisted(() => ({
  catalog: vi.fn(),
  row: vi.fn(),
  blocked: false,
  retainMentions: vi.fn(),
}));
vi.mock("@aomi-labs/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@aomi-labs/react")>();
  return {
    ...original,
    // This standalone fixture also covers a missing runtime; preserve real
    // runtime subscriptions and task selection when it is present.
    useThreadTaskRuns: () => {
      const runtime = original.useOptionalAomiRuntime();
      return original.selectTaskRuns(runtime?.events ?? []);
    },
  };
});
vi.mock("./assistant-message-row", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./assistant-message-row")>();
  return {
    AssistantMessageRow: (
      props: Parameters<typeof original.AssistantMessageRow>[0],
    ) => {
      work.row();
      return <original.AssistantMessageRow {...props} />;
    },
  };
});
vi.mock("./trace-attribution", () => ({
  TraceAttributionProvider: ({ children }: { children: ReactNode }) => {
    work.catalog();
    return children;
  },
}));
vi.mock("@/controls/payment-required-gate", () => ({
  PaymentRequiredGate: () => null,
}));
vi.mock("@/controls/safety-select", () => ({
  ThreadSafetyProvider: ({ children }: { children: ReactNode }) => children,
  useThreadSafety: () => null,
}));
vi.mock("@/composer/capability-composer/provider", () => ({
  CapabilityComposerProvider: ({ children }: { children: ReactNode }) =>
    children,
  useCapabilityComposer: () => ({
    prepareSubmit: (event: React.FormEvent) => {
      if (work.blocked) event.preventDefault();
    },
    retainMentions: work.retainMentions,
    hintsEnabled: false,
  }),
}));
vi.mock("@/composer/capability-composer/input", () => ({
  CapabilityMentionInput: () => {
    const composer = useComposerRuntime();
    const text = useSyncExternalStore(
      (notify) => composer.subscribe(notify),
      () => composer.getState().text,
    );
    // Model the capability editor's controlled text, not Primitive.Input's
    // separate editing-mode gate, which this rendering fixture does not use.
    return (
      <textarea
        aria-label="Message input"
        value={text}
        onChange={(event) => composer.setText(event.target.value)}
      />
    );
  },
}));
vi.mock("./working-trace", () => ({
  AssistantTurnParts: () => {
    const text = useMessage((message) =>
      message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    );
    return <span>{text}</span>;
  },
}));
vi.mock("./capability-message-text", () => ({
  CapabilityMessageText: () => {
    const text = useMessage((message) =>
      message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
    );
    return <span>{text}</span>;
  },
}));
vi.mock("@/sidebar/activity/activity-sidebar", () => ({
  ActivitySidebar: () => {
    const runtime = useOptionalAomiRuntime();
    return (
      <div data-testid="live-activity">
        {runtime?.turnState}/{runtime?.events.length}
      </div>
    );
  },
}));

const identity = (message: ThreadMessageLike) => message;
const onNew = async () => {};
const history: ThreadMessageLike[] = [
  {
    id: "history",
    role: "assistant",
    content: [{ type: "text", text: "Saved answer" }],
  },
];
function Fixture({
  api,
  messages = history,
  loading = false,
  sendDisabled = false,
  runConfig,
}: {
  api: AomiRuntimeApi | null;
  messages?: ThreadMessageLike[];
  loading?: boolean;
  sendDisabled?: boolean;
  runConfig?: AppendMessage["runConfig"];
}) {
  const native = useExternalStoreRuntime({
    messages,
    isLoading: loading,
    isRunning: false,
    onNew,
    convertMessage: identity,
  });
  useEffect(() => {
    native.thread.composer.setText("Ready draft");
    if (runConfig) native.thread.composer.setRunConfig(runConfig);
  }, [native, runConfig]);
  const composer = useMemo(
    () => <AomiFrame.Composer sendDisabled={sendDisabled} />,
    [sendDisabled],
  );
  return (
    <AomiRuntimeApiProvider value={api}>
      <AssistantRuntimeProvider runtime={native}>
        {composer}
      </AssistantRuntimeProvider>
    </AomiRuntimeApiProvider>
  );
}
const api = (patch: Partial<AomiRuntimeApi> = {}) =>
  ({
    events: [],
    pendingActions: [],
    isStopping: false,
    // The dot covers the send until the backend accepts it.
    isSubmitting: true,
    turnState: "complete",
    cancelGeneration: () => {},
    ...patch,
  }) as AomiRuntimeApi;

const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  work.catalog.mockClear();
  work.row.mockClear();
  work.blocked = false;
  work.retainMentions.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value() {},
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
describe("thread rendering under live runtime updates", () => {
  const inputControl = (active: string | null) => ({
    active_turn_id: active,
    accepted_input_revision: active ? 2 : 0,
    applied_input_revision: active ? 2 : 0,
    queued_turn_ids: [],
    event_sequence: 10,
    stream_epoch: "status-epoch",
  });

  it("keeps the existing controls neutral even when the SDK has input receipts or queued work", () => {
    const retained: PendingInput = {
      inputId: "update",
      operation: "steer",
      targetTurnId: "turn-1",
      message: "Private retained draft",
      status: "rejected",
    };
    const view = render(
      <Fixture
        api={api({
          isSubmitting: false,
          turnState: "processing",
          supportsSteering: true,
          turnInputs: [retained],
          turnControl: {
            ...inputControl("turn-1"),
            queued_turn_ids: ["sdk-queue"],
          },
        })}
      />,
    );
    expect(
      view.queryByRole("button", { name: /Queue|Update current/ }),
    ).toBeNull();
    expect(
      view.queryByText(/Update (accepted|applied|not accepted)|Queued:/),
    ).toBeNull();
    expect(view.queryByText(retained.message)).toBeNull();
    expect(view.getByRole("button", { name: "Send message" })).toBeVisible();
    expect(retained.message).toBe("Private retained draft");
  });

  it.each([false, true])(
    "uses ordinary Send with captured capabilities while active=%s",
    async (active) => {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const queueMessage = vi.fn();
      const runConfig = {
        custom: {
          aomiCapabilityHints: {
            capabilities: [{ kind: "chain", id: "eip155:8453" }],
          },
        },
      };
      const view = render(
        <Fixture
          runConfig={runConfig}
          api={api({
            isSubmitting: false,
            supportsSteering: true,
            turnState: active ? "processing" : "complete",
            turnControl: inputControl(active ? "turn-1" : null),
            sendMessage,
            queueMessage,
          })}
        />,
      );
      const button = view.getByRole("button", { name: "Send message" });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
      await waitFor(() =>
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith(
          "Ready draft",
          runConfig,
        ),
      );
      expect(queueMessage).not.toHaveBeenCalled();
      expect(work.retainMentions).toHaveBeenCalledExactlyOnceWith(new Set());
      expect(view.getByRole("textbox")).toHaveValue("");
    },
  );

  it.each([false, true])(
    "validates routing before ordinary Send while active=%s",
    async (active) => {
      work.blocked = true;
      const sendMessage = vi.fn();
      const view = render(
        <Fixture
          api={api({
            isSubmitting: false,
            turnState: active ? "processing" : "complete",
            turnControl: inputControl(active ? "turn-1" : null),
            sendMessage,
          })}
        />,
      );
      fireEvent.click(view.getByRole("button", { name: "Send message" }));
      expect(sendMessage).not.toHaveBeenCalled();
      expect(work.retainMentions).not.toHaveBeenCalled();
      expect(view.getByRole("textbox")).toHaveValue("Ready draft");
    },
  );

  it("keeps Stop in its existing position until a follow-up is ready to send", () => {
    const view = render(
      <Fixture
        api={api({
          isSubmitting: false,
          turnState: "processing",
          turnControl: inputControl("turn-1"),
        })}
      />,
    );
    fireEvent.change(view.getByRole("textbox"), { target: { value: "" } });
    expect(view.getByRole("button", { name: "Stop generating" })).toBeVisible();
    expect(view.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.change(view.getByRole("textbox"), {
      target: { value: "Continue on Base" },
    });
    expect(view.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(view.queryByRole("button", { name: "Stop generating" })).toBeNull();
  });

  it("keeps catalog/provider work stable on unrelated event/status snapshots while native messages still update", async () => {
    const view = render(<Fixture api={api()} />);
    await waitFor(() => expect(view.getByText("Saved answer")).toBeVisible());
    // Reader restoration legitimately updates ThreadBody on its first frame.
    // Measure unrelated runtime updates only after that initialization settles.
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const before = work.catalog.mock.calls.length;
    const rowsBefore = work.row.mock.calls.length;
    view.rerender(
      <Fixture
        api={api({
          turnState: "processing",
          events: [
            {
              type: "turn_state_changed",
              state: "processing",
            } as AomiRuntimeApi["events"][number],
          ],
        })}
      />,
    );
    expect(view.getByTestId("live-activity")).toHaveTextContent("processing/1");
    expect(work.catalog.mock.calls.length).toBe(before);
    expect(work.row.mock.calls.length).toBe(rowsBefore);
    const changed: ThreadMessageLike[] = [
      {
        ...history[0],
        content: [{ type: "text", text: "Updated terminal answer" }],
        status: { type: "complete", reason: "stop" },
      },
    ];
    view.rerender(<Fixture api={api()} messages={changed} />);
    await waitFor(() =>
      expect(view.getByText("Updated terminal answer")).toBeVisible(),
    );
    expect(view.queryByText("Saved answer")).toBeNull();
    expect(work.catalog.mock.calls.length).toBe(before);
  });
  it("publishes task presence, native terminal text, and notices while skipping unchanged message rows", async () => {
    const empty: ThreadMessageLike[] = [
      {
        id: "live",
        role: "assistant",
        content: [],
        status: { type: "running" },
      },
    ];
    const view = render(<Fixture api={api()} messages={empty} />);
    await act(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(
      view.getByRole("status", { name: "Waiting for response" }),
    ).toBeVisible();
    const started = {
      type: "task_started",
      agent_id: "child",
      call_id: "child-call",
      app: "market",
      occurred_at: 1,
    } as AomiRuntimeApi["events"][number];
    view.rerender(
      <Fixture api={api({ events: [started] })} messages={empty} />,
    );
    expect(
      view.queryByRole("status", { name: "Waiting for response" }),
    ).toBeNull();
    const running = work.row.mock.calls.length;
    const phase = {
      ...started,
      type: "task_phase",
      phase: "Reading prices",
      elapsed_ms: 10,
    } as AomiRuntimeApi["events"][number];
    view.rerender(
      <Fixture api={api({ events: [started, phase] })} messages={empty} />,
    );
    expect(work.row.mock.calls.length).toBe(running);
    const completed = {
      ...started,
      type: "task_completed",
      status: "completed",
    } as AomiRuntimeApi["events"][number];
    view.rerender(
      <Fixture api={api({ events: [started, completed] })} messages={empty} />,
    );
    expect(
      view.getByRole("status", { name: "Waiting for response" }),
    ).toBeVisible();
    expect(work.row.mock.calls.length).toBeGreaterThan(running);
    view.rerender(
      <Fixture
        api={api()}
        messages={[
          { ...empty[0], status: { type: "complete", reason: "stop" } },
        ]}
      />,
    );
    expect(
      view.queryByRole("status", { name: "Waiting for response" }),
    ).toBeNull();
    expect(view.getByTestId(testIds.assistantMessage)).toHaveClass("py-0");
    const terminal: ThreadMessageLike[] = [
      {
        ...empty[0],
        content: [{ type: "text", text: "The terminal answer" }],
        status: { type: "complete", reason: "stop" },
      },
    ];
    view.rerender(<Fixture api={api()} messages={terminal} />);
    expect(view.getByText("The terminal answer")).toBeVisible();
    expect(
      view.queryByRole("status", { name: "Waiting for response" }),
    ).toBeNull();
    view.rerender(
      <Fixture
        api={api()}
        messages={[
          {
            ...terminal[0],
            metadata: {
              custom: {
                aomiNoticeKind: "error",
                aomiNoticeTitle: "Admission failed",
              },
            },
          },
        ]}
      />,
    );
    expect(view.getByText("Admission failed")).toBeVisible();
  });
  it("hands the dot to the working trace once the send is accepted", () => {
    const empty: ThreadMessageLike[] = [
      {
        id: "live",
        role: "assistant",
        content: [],
        status: { type: "running" },
      },
    ];
    const view = render(<Fixture api={api()} messages={empty} />);
    expect(
      view.getByRole("status", { name: "Waiting for response" }),
    ).toBeVisible();
    view.rerender(
      <Fixture
        api={api({ isSubmitting: false, turnState: "processing" })}
        messages={empty}
      />,
    );
    expect(
      view.queryByRole("status", { name: "Waiting for response" }),
    ).toBeNull();
    view.rerender(
      <Fixture
        api={api({ isSubmitting: false, isStartUncertain: true })}
        messages={empty}
      />,
    );
    expect(
      view.getByRole("status", { name: "Waiting for response" }),
    ).toBeVisible();
  });
  it("shows a work-limit notice as paused with Continue", async () => {
    const view = render(
      <Fixture
        api={api({ isSubmitting: false })}
        messages={[
          {
            id: "aomi-notice-1",
            role: "assistant",
            content: [{ type: "text", text: "Execution timed out" }],
            metadata: {
              custom: {
                aomiNoticeKind: "error",
                aomiNoticeTitle: "Error",
                aomiNoticeCode: "execution_active_timeout",
              },
            },
          },
        ]}
      />,
    );
    expect(view.getByText("Paused at the work time limit")).toBeVisible();
    expect(view.getByText("Finished steps are saved.")).toBeVisible();
    expect(view.getByTestId(testIds.notice)).not.toHaveClass(
      "border-destructive/40",
    );
    expect(view.getByTestId(testIds.continueAfterPause)).toBeEnabled();
  });
  it("shows a failed saved chat as an error with Retry, not the welcome", () => {
    const retryThreadLoad = vi.fn();
    const view = render(
      <Fixture
        api={api({ threadLoadError: true, retryThreadLoad })}
        messages={[]}
      />,
    );
    expect(view.getByText("Couldn't load this conversation")).toBeVisible();
    expect(view.queryByTestId(testIds.composer)).toBeNull();
    fireEvent.click(view.getByTestId(testIds.threadLoadRetry));
    expect(retryThreadLoad).toHaveBeenCalledOnce();
  });
  it("updates a native message when it is no longer the last message", async () => {
    const empty: ThreadMessageLike[] = [
      {
        id: "live",
        role: "assistant",
        content: [],
        status: { type: "running" },
      },
    ];
    const view = render(<Fixture api={api()} messages={empty} />);
    expect(
      view.getByRole("status", { name: "Waiting for response" }),
    ).toBeVisible();
    view.rerender(
      <Fixture
        api={api()}
        messages={[
          ...empty,
          {
            id: "next-prompt",
            role: "user",
            content: [{ type: "text", text: "Next prompt" }],
          },
          { ...empty[0], id: "next-live" },
        ]}
      />,
    );
    await waitFor(() =>
      expect(view.getAllByTestId(testIds.assistantMessage)).toHaveLength(2),
    );
    const rows = view.getAllByTestId(testIds.assistantMessage);
    expect(
      within(rows[0]).queryByRole("status", { name: "Waiting for response" }),
    ).toBeNull();
    expect(
      within(rows[1]).getByRole("status", { name: "Waiting for response" }),
    ).toBeVisible();
  });
  it("updates pending-review state and native loading, without delaying controls", async () => {
    const view = render(<Fixture api={api()} />);
    await waitFor(() => expect(view.getByText("Saved answer")).toBeVisible());
    const before = work.catalog.mock.calls.length;
    view.rerender(
      <Fixture
        api={api({
          pendingActions: [{} as AomiRuntimeApi["pendingActions"][number]],
        })}
      />,
    );
    expect(work.catalog.mock.calls.length).toBeGreaterThan(before);
    const reviewing = work.catalog.mock.calls.length;
    view.rerender(<Fixture api={api()} />);
    const noReview = work.catalog.mock.calls.length;
    view.rerender(<Fixture api={api()} loading />);
    await waitFor(() =>
      expect(work.catalog.mock.calls.length).toBeGreaterThan(noReview),
    );
    expect(work.catalog.mock.calls.length).toBeGreaterThan(reviewing);
    view.rerender(<Fixture api={api()} />);
    await waitFor(() =>
      expect(view.getByRole("button", { name: "Send message" })).toBeEnabled(),
    );
    const ready = work.catalog.mock.calls.length;
    view.rerender(<Fixture api={api()} sendDisabled />);
    expect(view.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(work.catalog.mock.calls.length).toBeGreaterThan(ready);
    view.rerender(<Fixture api={api()} sendDisabled={false} />);
    await act(async () => {});
    expect(view.getByText("Saved answer")).toBeVisible();
    expect(view.getByRole("button", { name: "Send message" })).toBeEnabled();
  });
  it("adds activity when a runtime arrives and removes it when the runtime leaves", async () => {
    const view = render(<Fixture api={null} />);
    await waitFor(() => expect(view.getByText("Saved answer")).toBeVisible());
    expect(view.queryByTestId("live-activity")).toBeNull();
    const before = work.catalog.mock.calls.length;
    view.rerender(<Fixture api={api()} />);
    expect(view.getByTestId("live-activity")).toBeVisible();
    expect(work.catalog.mock.calls.length).toBeGreaterThan(before);
    view.rerender(<Fixture api={null} />);
    expect(view.queryByTestId("live-activity")).toBeNull();
  });
});
