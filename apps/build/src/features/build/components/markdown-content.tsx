"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/class-names";

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function MarkdownContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);

  return (
    <div className={cn("md-thread text-[13px] leading-relaxed", className)}>
      {blocks.map((block, i) => {
        if (block.startsWith("```")) {
          const inner = block.replace(/^```\w*\n?/, "").replace(/```$/, "");
          return (
            <pre key={i}>
              <code>{inner.trimEnd()}</code>
            </pre>
          );
        }

        const lines = block.split("\n");
        const elements: ReactNode[] = [];
        let listItems: string[] = [];
        let listType: "ul" | "ol" | null = null;

        const flushList = () => {
          if (!listItems.length || !listType) return;
          const ListTag = listType;
          elements.push(
            <ListTag key={`list-${elements.length}`}>
              {listItems.map((item, idx) => (
                <li key={idx}>{renderInline(item)}</li>
              ))}
            </ListTag>,
          );
          listItems = [];
          listType = null;
        };

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            flushList();
            continue;
          }

          const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
          const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);

          if (olMatch) {
            if (listType && listType !== "ol") flushList();
            listType = "ol";
            listItems.push(olMatch[1]);
            continue;
          }

          if (ulMatch) {
            if (listType && listType !== "ul") flushList();
            listType = "ul";
            listItems.push(ulMatch[1]);
            continue;
          }

          flushList();
          elements.push(
            <p key={`p-${elements.length}`}>{renderInline(trimmed)}</p>,
          );
        }

        flushList();
        return <div key={i}>{elements}</div>;
      })}
    </div>
  );
}
