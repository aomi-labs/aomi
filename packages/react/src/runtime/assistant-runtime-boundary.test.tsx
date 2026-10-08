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
import { AssistantRuntimeBoundary } from "./assistant-runtime-boundary";

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

import { useEffect } from "react";
import {
  AomiChatBoundary,
  ChatBoundaryContext,
} from "./assistant-runtime-boundary";
import { createChatViewStore } from "../state/chat-view-store";

const noop = () => {};
it("keeps the shell mounted while replacing chat subscribers and restoring each draft", async () => {
  const mounts = vi.fn();
  const store = createChatViewStore();
  function Shell() {
    useEffect(() => {
      mounts();
    }, []);
    return <span>Shell</span>;
  }
  function StableHarness({ threadId }: { threadId: string }) {
    const restore = useRef<(text: string) => void>(() => {});
    const adapter = {
      messages: threadId === "a" ? populated : [],
      convertMessage: (message: ThreadMessageLike) => message,
      onNew: vi.fn(),
    };
    return (
      <AssistantRuntimeBoundary
        adapter={{ ...adapter, messages: [] }}
        restoreComposerText={restore}
      >
        <ChatBoundaryContext.Provider
          value={{
            threadId,
            adapter,
            restoreComposerText: restore,
            store,
            generation: 0,
            deferMessages: false,
            onBoundaryMount: noop,
          }}
        >
          <Shell />
          <AomiChatBoundary>
            <ThreadPrimitive.Root>
              <ThreadPrimitive.Messages
                components={{ UserMessage: Message, AssistantMessage: Message }}
              />
              <ComposerPrimitive.Root>
                <ComposerPrimitive.Input aria-label="Saved draft" />
              </ComposerPrimitive.Root>
            </ThreadPrimitive.Root>
          </AomiChatBoundary>
        </ChatBoundaryContext.Provider>
      </AssistantRuntimeBoundary>
    );
  }
  const view = render(<StableHarness threadId="a" />);
  fireEvent.change(screen.getByLabelText("Saved draft"), {
    target: { value: "draft for a" },
  });
  view.rerender(<StableHarness threadId="b" />);
  expect(screen.getByLabelText("Saved draft")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Saved draft"), {
    target: { value: "draft for b" },
  });
  view.rerender(<StableHarness threadId="a" />);
  await waitFor(() =>
    expect(screen.getByLabelText("Saved draft")).toHaveValue("draft for a"),
  );
  expect(screen.getByText("saved-answer")).toBeVisible();
  expect(mounts).toHaveBeenCalledOnce();
  expect(store.get("b")?.draft).toBe("draft for b");
});
