import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { messageActions } from "../message-actions";

const messages: ThreadMessageLike[] = [
  {
    id: "aomi-user-0",
    role: "user",
    content: [{ type: "text", text: "Supply USDC" }],
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
  it("reruns the selected completed callback answer through the server no-tools intent", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<Harness send={send} />);
    fireEvent.click(screen.getByText("Rerun"));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.any(String), {
        regenerate: "broadcast-terminal:batch:response",
      }),
    );
    expect(send.mock.calls[0]![0]).not.toContain("Supply USDC");
  });

  it("editing a sent message sends an explicit correction and retains the original ledger", async () => {
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
    expect(send.mock.calls[0]![0]).toBe(
      "Correction to my earlier message:\n> Supply USDC\n\nRevised request:\nExplain the supply instead",
    );
    expect(messages[0]!.content).toEqual([
      { type: "text", text: "Supply USDC" },
    ]);
  });

  it("rejects unfinished or tool-only projected rows without sending", async () => {
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
      "Only a completed answer can be rerun",
    );
  });

  it("never restores a failed no-tools rerun as an ordinary executable composer prompt", async () => {
    const restore = vi.fn();
    const actions = messageActions({
      messages,
      send: vi.fn().mockRejectedValue(new Error("busy")),
      restore,
      unavailable: vi.fn(),
    });
    await actions.onReload("aomi-user-0");
    expect(restore).not.toHaveBeenCalled();
  });

  it("preserves capability chips rehydrated from the selected user message", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const selected = {
      ...messages[0]!,
      metadata: {
        custom: { aomiCapabilityHints: [{ kind: "app", id: "name:aave" }] },
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

  it("restores the revised text after rejection, preserving selected capability hints", async () => {
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
    expect(restore).toHaveBeenCalledWith('Updated "quoted" request');
  });
});
