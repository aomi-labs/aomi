import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { AssistantRuntimeBoundary } from "../assistant-runtime-boundary";

function Message() {
  const id = useMessage((message) => message.id);
  return <MessagePrimitive.Root>{id}</MessagePrimitive.Root>;
}

function Harness({
  threadId,
  messages,
}: {
  threadId: string;
  messages: ThreadMessageLike[];
}) {
  const restore = useRef<(text: string) => void>(() => {});
  return (
    <AssistantRuntimeBoundary
      key={threadId}
      adapter={{
        messages,
        convertMessage: (message) => message,
        onNew: vi.fn(),
      }}
      restoreComposerText={restore}
    >
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages
          components={{ UserMessage: Message, AssistantMessage: Message }}
        />
        <ComposerPrimitive.Root>
          <ComposerPrimitive.Input aria-label="Draft" />
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeBoundary>
  );
}

const populated: ThreadMessageLike[] = [
  {
    id: "saved-user",
    role: "user",
    content: [{ type: "text", text: "Hello" }],
  },
  {
    id: "saved-answer",
    role: "assistant",
    content: [{ type: "text", text: "Hi" }],
  },
];

describe("assistant runtime chat boundary", () => {
  it("moves from a loaded chat to empty New chat and back without stale message indices", async () => {
    const view = render(<Harness threadId="saved" messages={populated} />);
    expect(screen.getByText("saved-user")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "old chat draft" },
    });

    view.rerender(<Harness threadId="new" messages={[]} />);
    expect(screen.queryByText("saved-user")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Draft")).toHaveValue("");

    view.rerender(<Harness threadId="saved" messages={populated} />);
    await waitFor(() => expect(screen.getByText("saved-answer")).toBeVisible());
    expect(screen.getByLabelText("Draft")).toHaveValue("");
  });

  it("preserves the current draft when the same chat hydrates its messages", async () => {
    const view = render(<Harness threadId="saved" messages={[]} />);
    fireEvent.change(screen.getByLabelText("Draft"), {
      target: { value: "keep this draft" },
    });
    view.rerender(<Harness threadId="saved" messages={populated} />);
    await waitFor(() => expect(screen.getByText("saved-user")).toBeVisible());
    expect(screen.getByLabelText("Draft")).toHaveValue("keep this draft");
  });
});
