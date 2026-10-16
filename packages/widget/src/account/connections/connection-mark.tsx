"use client";

import { Code, Terminal } from "lucide-react";
import type { AomiConnectionKind } from "@aomi-labs/client";
import { AomiMark } from "@/ui/aomi-mark";
import {
  ClaudeMark,
  CursorMark,
  OpenAIMark,
  TelegramMark,
} from "@/wallet/wallet-brands";

/** A connection's mark: Aomi, Telegram, a known AI client, a terminal or code. */
export function ConnectionMark({
  kind,
  name,
  size = 20,
}: {
  kind: AomiConnectionKind;
  name: string;
  size?: number;
}) {
  const mark =
    kind === "portal" ? (
      <AomiMark size={size - 2} className="text-aomi-fg" />
    ) : kind === "telegram" ? (
      <TelegramMark size={size} />
    ) : kind === "cli" ? (
      <Terminal size={size - 2} className="text-aomi-fg" />
    ) : /claude/i.test(name) ? (
      <ClaudeMark size={size} />
    ) : /codex|openai|chatgpt/i.test(name) ? (
      <OpenAIMark size={size} className="text-aomi-fg" />
    ) : /cursor/i.test(name) ? (
      <CursorMark size={size} className="text-aomi-fg" />
    ) : (
      <Code size={size - 2} className="text-aomi-fg" />
    );
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center"
      style={{ width: size + 12, height: size + 12 }}
    >
      {mark}
    </span>
  );
}
