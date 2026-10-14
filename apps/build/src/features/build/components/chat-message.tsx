"use client";

import { Square } from "lucide-react";

import { MarkdownContent } from "@/features/build/components/markdown-content";
import { cn } from "@/lib/class-names";

export type ChatMessageProps = {
  role: "user" | "assistant" | "system";
  content: string;
  isStreaming?: boolean;
  onStop?: () => void;
  timestamp?: string;
  model?: string;
};

/**
 * Thread rendering — product language only (You / Aomi).
 * Dense stack: tight padding so messages don't float in voids.
 */
export function ChatMessage({
  role,
  content,
  isStreaming,
  onStop,
  timestamp,
  model,
}: ChatMessageProps) {
  if (role === "system") {
    return (
      <div className="mx-auto max-w-3xl px-1 py-1.5">
        <div className="border-border bg-surface-1 text-dim rounded-md border px-3 py-1.5 text-center text-[12px] leading-5">
          {content}
        </div>
      </div>
    );
  }

  if (role === "user") {
    return (
      <div className="w-full py-1.5">
        <div className="mx-auto flex max-w-3xl justify-end">
          <div className="max-w-[85%] sm:max-w-[75%]">
            <div className="text-dim mb-0.5 flex items-center justify-end gap-2 text-[11px]">
              {timestamp ? <span>{timestamp}</span> : null}
              <span>You</span>
            </div>
            <div className="bg-surface-2 text-foreground rounded-2xl rounded-br-md px-3.5 py-2 text-[13px] leading-relaxed whitespace-pre-wrap">
              {content}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full py-2">
      <div className="mx-auto max-w-3xl">
        <div className="text-dim mb-1 flex items-center gap-2 text-[11px]">
          <span className="text-subtle font-medium">Aomi</span>
          {model &&
          model.toLowerCase() !== "aomi" &&
          !model.toLowerCase().includes("local mock") ? (
            <span className="text-dim">· {model}</span>
          ) : null}
          {timestamp ? <span>· {timestamp}</span> : null}
        </div>

        <MarkdownContent content={content} />
        {isStreaming ? (
          <span
            className="bg-foreground/70 mt-1 inline-block h-4 w-[2px] animate-pulse"
            aria-hidden
          />
        ) : null}

        {isStreaming && onStop ? (
          <button
            type="button"
            onClick={onStop}
            className={cn(
              "border-border bg-surface-1 text-dim hover:text-foreground mt-2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors",
            )}
          >
            <Square className="size-2.5 fill-current" />
            Skip to end
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="w-full py-2">
      <div className="mx-auto max-w-3xl">
        <div className="text-dim mb-1 text-[11px]">
          <span className="text-subtle font-medium">Aomi</span>
        </div>
        <div className="flex items-center gap-1.5" aria-label="Thinking">
          <span className="bg-dim h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
          <span className="bg-dim h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
          <span className="bg-dim h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}
