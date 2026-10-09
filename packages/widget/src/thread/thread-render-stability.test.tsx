import { act, render, waitFor, within } from "@testing-library/react";
import { useEffect, useMemo, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  useExternalStoreRuntime,
  useMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  AomiRuntimeApiProvider,
  useOptionalAomiRuntime,
  type AomiRuntimeApi,
} from "@aomi-labs/react";
import { AomiFrame } from "@/frame/aomi-frame";
import { testIds } from "@/test-ids";

const work = vi.hoisted(() => ({
  catalog: vi.fn(),
  row: vi.fn(),
  sequence: [] as string[],
  safety: { enabled: false, held: false },
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
  useThreadSafety: () =>
    work.safety.enabled
      ? {
          pending: work.safety.held,
          started: false,
          busy: false,
          hasHeld: () => work.safety.held,
          commitHeld: async () => {
            work.sequence.push("saved");
            work.safety.held = false;
            return true;
          },
        }
      : null,
}));
vi.mock("@/composer/capability-composer/provider", () => ({
  CapabilityComposerProvider: ({ children }: { children: ReactNode }) =>
    children,
  useCapabilityComposer: () => ({
    prepareSubmit: () => {},
    hintsEnabled: false,
  }),
}));
vi.mock("@/composer/capability-composer/input", () => ({
  CapabilityMentionInput: () => <ComposerPrimitive.Input />,
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
const onNew = async () => {
  work.sequence.push("sent");
};
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
}: {
  api: AomiRuntimeApi | null;
  messages?: ThreadMessageLike[];
  loading?: boolean;
  sendDisabled?: boolean;
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
  }, [native]);
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
  work.sequence.length = 0;
  work.safety.enabled = false;
  work.safety.held = false;
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
  it("keeps catalog/provider work stable on unrelated event/status snapshots while native messages still update", async () => {
    const view = render(<Fixture api={api()} />);
    await waitFor(() => expect(view.getByText("Saved answer")).toBeVisible());
    // Reader restoration legitimately updates ThreadBody on its first frame.
    // Measure unrelated runtime updates only after that initialization settles.
    await act(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
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
      { id: "live", role: "assistant", content: [], status: { type: "running" } },
    ];
    const view = render(<Fixture api={api()} messages={empty} />);
    await act(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(view.getByRole("status", { name: "Waiting for response" })).toBeVisible();
    const started = {
      type: "task_started",
      agent_id: "child",
      call_id: "child-call",
      app: "market",
      occurred_at: 1,
    } as AomiRuntimeApi["events"][number];
    view.rerender(<Fixture api={api({ events: [started] })} messages={empty} />);
    expect(view.queryByRole("status", { name: "Waiting for response" })).toBeNull();
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
    expect(view.getByRole("status", { name: "Waiting for response" })).toBeVisible();
    expect(work.row.mock.calls.length).toBeGreaterThan(running);
    view.rerender(
      <Fixture
        api={api()}
        messages={[
          { ...empty[0], status: { type: "complete", reason: "stop" } },
        ]}
      />,
    );
    expect(view.queryByRole("status", { name: "Waiting for response" })).toBeNull();
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
    expect(view.queryByRole("status", { name: "Waiting for response" })).toBeNull();
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
  it("updates a native message when it is no longer the last message", async () => {
    const empty: ThreadMessageLike[] = [
      { id: "live", role: "assistant", content: [], status: { type: "running" } },
    ];
    const view = render(<Fixture api={api()} messages={empty} />);
    expect(view.getByRole("status", { name: "Waiting for response" })).toBeVisible();
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
  it("persists a held safety choice before the send button submits turn one", async () => {
    work.safety.enabled = true;
    work.safety.held = true;
    const view = render(<Fixture api={api()} />);
    const send = await view.findByRole("button", { name: "Send message" });
    await waitFor(() => expect(send).toBeEnabled());
    await act(async () => send.click());
    await waitFor(() => expect(work.sequence).toEqual(["saved", "sent"]));
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
