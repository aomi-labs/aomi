import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ActionBarPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { messageActions } from "./message-actions";
import { useRef } from "react";

const messages: ThreadMessageLike[] = [
  {
    id: "aomi-user-0",
    role: "user",
    content: [{ type: "text", text: "Supply USDC" }],
    metadata: { custom: { aomiUserMessageKey: "original:user" } },
  },
  {
    id: "turn:original",
    role: "assistant",
    content: [{ type: "text", text: "Confirmed; next pair prepared." }],
    metadata: {
      custom: { aomiResponseMessageKey: "broadcast-terminal:batch:response" },
    },
  },
];

function UserMessage() {
  return (
    <MessagePrimitive.Root>
      <ActionBarPrimitive.Edit>Edit</ActionBarPrimitive.Edit>
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input aria-label="Revision" />
        <ComposerPrimitive.Send>Save and resend</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}
function AssistantMessage() {
  return (
    <MessagePrimitive.Root>
      <ActionBarPrimitive.Reload>Rerun</ActionBarPrimitive.Reload>
    </MessagePrimitive.Root>
  );
}
function Harness({ send }: { send: ReturnType<typeof vi.fn> }) {
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message: ThreadMessageLike) => message,
    ...messageActions({
      messages,
      send,
      restore: vi.fn(),
      unavailable: vi.fn(),
    }),
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages
        components={{ UserMessage, AssistantMessage }}
      />
    </AssistantRuntimeProvider>
  );
}

describe("message action wiring", () => {
  it("reruns an answer by resending the request before it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Harness send={send} />);
    fireEvent.click(screen.getByText("Rerun"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("Supply USDC", {
        edit: "original:user",
      }),
    );
  });

  it("editing targets the saved user message with revised text", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Harness send={send} />);
    fireEvent.click(screen.getByText("Edit"));
    await waitFor(() => expect(screen.getByText("Edit")).toBeDisabled());
    fireEvent.change(screen.getByLabelText("Revision"), {
      target: { value: "Explain the supply instead" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Revision")).toHaveValue(
        "Explain the supply instead",
      ),
    );
    fireEvent.click(screen.getByText("Save and resend"));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]![0]).toBe("Explain the supply instead");
    expect(send.mock.calls[0]![1]).toEqual({ edit: "original:user" });
    expect(messages[0]!.content).toEqual([
      { type: "text", text: "Supply USDC" },
    ]);
  });

  it("rejects requests without a saved message key without sending", async () => {
    const send = vi.fn();
    const unavailable = vi.fn();
    const actions = messageActions({
      messages: messages.map((message) => ({
        ...message,
        metadata: undefined,
      })),
      send,
      restore: vi.fn(),
      unavailable,
    });
    await actions.onReload("aomi-user-0");
    expect(send).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith(
      "Only a saved request can be edited or rerun",
    );
  });

  it("reports a failed rerun instead of restoring it into the composer", async () => {
    const restore = vi.fn();
    const unavailable = vi.fn();
    const actions = messageActions({
      messages,
      send: vi.fn().mockRejectedValue(new Error("busy")),
      restore,
      unavailable,
    });
    await actions.onReload("aomi-user-0");
    expect(restore).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith(
      "Couldn't rerun the response. Try again.",
    );
  });

  it("preserves capability chips rehydrated from the selected user message", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const selected = {
      ...messages[0]!,
      metadata: {
        custom: {
          aomiUserMessageKey: "original:user",
          aomiCapabilityHints: [{ kind: "app", id: "name:aave" }],
        },
      },
    };
    await messageActions({
      messages: [selected],
      send,
      restore: vi.fn(),
      unavailable: vi.fn(),
    }).onEdit({
      sourceId: selected.id,
      content: [{ type: "text", text: "Explain instead" }],
    } as AppendMessage);
    expect(send.mock.calls[0]![0]).toContain(
      'Selected app task target: {"app":"aave"}',
    );
  });

  it("reports an edit rejection without turning it into a new executable request", async () => {
    const send = vi.fn().mockRejectedValue(new Error("busy"));
    const restore = vi.fn();
    const actions = messageActions({
      messages,
      send,
      restore,
      unavailable: vi.fn(),
    });
    await actions.onEdit({
      sourceId: "aomi-user-0",
      content: [{ type: "text", text: 'Updated "quoted" request' }],
      runConfig: {
        custom: {
          aomiCapabilityHints: {
            capabilities: [{ kind: "app", id: "name:aave" }],
          },
        },
      },
    } as AppendMessage);
    expect(send.mock.calls[0]![0]).toContain(
      'Selected app task target: {"app":"aave"}',
    );
    expect(restore).not.toHaveBeenCalled();
  });
});

function NewMessageHarness({ send }: { send: ReturnType<typeof vi.fn> }) {
  const restore = useRef<(text: string) => void>(() => {});
  const runtime = useExternalStoreRuntime({
    messages: [] as ThreadMessageLike[],
    ...messageActions({
      messages: [],
      send,
      restore: (text) => restore.current(text),
      unavailable: vi.fn(),
    }),
    convertMessage: (message: ThreadMessageLike) => message,
  });
  restore.current = (text) => {
    if (!runtime.thread.composer.getState().text)
      runtime.thread.composer.setText(text);
  };
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerPrimitive.Root>
        <ComposerPrimitive.Input aria-label="New request" />
        <ComposerPrimitive.Send>Send request</ComposerPrimitive.Send>
      </ComposerPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

describe("new request composer", () => {
  it("clears while the backend accepts the edit and stays clear after success, sending once", async () => {
    let resolve!: () => void;
    const send = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    render(<NewMessageHarness send={send} />);
    const input = screen.getByLabelText("New request");
    fireEvent.change(input, { target: { value: "Check my balance" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(input).toHaveValue("");
    fireEvent.submit(input.closest("form")!);
    await act(async () => resolve());
    expect(send).toHaveBeenCalledOnce();
    expect(input).toHaveValue("");
  });

  it("restores a failed request without replacing a newer draft", async () => {
    let reject!: (error: Error) => void;
    const send = vi.fn(
      () =>
        new Promise<void>((_done, fail) => {
          reject = fail;
        }),
    );
    render(<NewMessageHarness send={send} />);
    const input = screen.getByLabelText("New request");
    fireEvent.change(input, { target: { value: "Check my balance" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await act(async () => reject(new Error("start uncertain")));
    expect(input).toHaveValue("Check my balance");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    fireEvent.change(input, { target: { value: "My newer draft" } });
    await act(async () => reject(new Error("not accepted")));
    expect(input).toHaveValue("My newer draft");
  });
});
