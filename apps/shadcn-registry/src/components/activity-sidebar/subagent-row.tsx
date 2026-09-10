"use client";

import { useState } from "react";
import { Bot, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { cn, type TaskRunState } from "@aomi-labs/react";
import { TextMessagePartProvider } from "@assistant-ui/react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";

export function SubagentRow({
  agent,
  index,
}: {
  agent: TaskRunState;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const hasMessage = Boolean(agent.message?.trim());
  const label = agent.label || agent.app || "Subagent";
  const status =
    agent.status === "completed"
      ? "Completed"
      : agent.status === "running"
        ? "Working"
        : agent.status === "failed"
          ? "Failed"
          : agent.status === "cancelled"
            ? "Cancelled"
            : "Stalled";

  return (
    <section className="py-2" aria-label={label}>
      <button
        type="button"
        aria-expanded={hasMessage ? open : undefined}
        aria-controls={hasMessage ? `subagent-${agent.agentId}` : undefined}
        onClick={() => hasMessage && setOpen((current) => !current)}
        className={cn(
          "flex w-full items-center gap-2.5 text-left",
          hasMessage ? "cursor-pointer" : "cursor-default",
        )}
      >
        <Bot
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0",
            index % 2 ? "text-pink-500" : "text-aomi-accent",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px]" title={label}>
          {label}
        </span>
        <SubagentStatus status={agent.status} label={status} />
      </button>
      {hasMessage && (
        <div
          id={`subagent-${agent.agentId}`}
          aria-hidden={!open}
          inert={!open}
          data-subagent-content={agent.agentId}
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="text-aomi-muted overflow-hidden break-words pl-[26px] pt-2 text-[12px] leading-5 [&_.aui-md>*:first-child]:mt-0 [&_.aui-md>*:last-child]:mb-0 [&_.aui-md]:text-[12px] [&_.aui-md]:leading-5">
              <TextMessagePartProvider text={agent.message!} isRunning={false}>
                <MarkdownText />
              </TextMessagePartProvider>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SubagentStatus({
  status,
  label,
}: {
  status: TaskRunState["status"];
  label: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-5 shrink-0 place-items-center",
        status === "completed"
          ? "text-aomi-success"
          : status === "failed"
            ? "text-aomi-danger"
            : status === "running"
              ? "text-aomi-accent"
              : "text-aomi-muted",
      )}
    >
      {status === "completed" ? (
        <Check aria-hidden="true" className="size-4" strokeWidth={2.2} />
      ) : status === "running" ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <CircleAlert aria-hidden="true" className="size-4" />
      )}
    </span>
  );
}
