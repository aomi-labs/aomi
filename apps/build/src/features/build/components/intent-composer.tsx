"use client";

import { ArrowUp, Laptop, Loader2, Square } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { ComposerModelPicker } from "@/features/build/components/composer-model-picker";
import { cn } from "@/lib/class-names";

type ActionPill = {
  label: string;
  hint?: string;
  action?: string;
};

export type IntentComposerHandle = {
  focus: () => void;
};

type IntentComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Cursor-style: while generating, primary action stops the run. */
  onStop?: () => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  actionPills?: ActionPill[];
  onActionPillClick?: (action: string) => void;
  compact?: boolean;
  footerHint?: string;
  autoFocus?: boolean;
};

/**
 * Intent composer — UI-only model picker + Preview honesty + send.
 * Shell already brands Aomi; picker shows Aomi once as the current model.
 */
export const IntentComposer = forwardRef<
  IntentComposerHandle,
  IntentComposerProps
>(function IntentComposer(
  {
    value,
    onChange,
    onSubmit,
    onStop,
    disabled,
    isLoading,
    placeholder = "What do you want to build?",
    actionPills,
    onActionPillClick,
    compact = false,
    footerHint = "Enter to send · Shift+Enter newline · Esc stop · ⌘N new",
    autoFocus = false,
  },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 140 : 180)}px`;
  }, [compact]);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        onActionPillClick?.("plan");
      }
      if (e.key === "Escape" && isLoading) {
        e.preventDefault();
        onStop?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onActionPillClick, isLoading, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isLoading) return;
        if (!disabled && value.trim()) onSubmit();
      }
    },
    [disabled, isLoading, value, onSubmit],
  );

  const canSend = Boolean(value.trim()) && !disabled && !isLoading;

  return (
    <div className="w-full">
      <div
        className={cn(
          "composer-surface",
          compact ? "px-3.5 py-3" : "px-4 py-3.5",
        )}
      >
        <textarea
          data-testid="build-intent-composer"
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled && !isLoading}
          placeholder={isLoading ? "Building… Esc to stop" : placeholder}
          rows={compact ? 2 : 3}
          className={cn(
            "text-foreground placeholder:text-dim w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none disabled:opacity-50",
            compact ? "min-h-[48px]" : "min-h-[72px]",
          )}
        />

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <ComposerModelPicker disabled={isLoading} />
            <span
              className="context-chip pointer-events-none cursor-default opacity-80"
              title="Preview build — timers until remote generate is connected"
            >
              <Laptop className="size-3.5 opacity-70" />
              Preview
            </span>
          </div>

          {isLoading && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="border-border bg-surface-2 text-foreground hover:bg-accent/50 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all duration-150"
              aria-label="Stop generation"
              title="Stop (Esc)"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSend}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all duration-150",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-brand-hover shadow-sm hover:scale-[1.03]"
                  : "bg-surface-3 text-dim",
              )}
              aria-label="Send message"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {actionPills && actionPills.length > 0 && !isLoading ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          {actionPills.map((pill) => (
            <button
              key={pill.label}
              type="button"
              onClick={() => onActionPillClick?.(pill.action ?? pill.label)}
              className="action-pill"
            >
              {pill.label}
              {pill.hint ? (
                <span className="text-dim text-[11px]">{pill.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {footerHint ? (
        <p className="text-dim mt-2.5 text-center text-[11px] leading-relaxed">
          {footerHint}
        </p>
      ) : null}
    </div>
  );
});
