import type { InterpretedToolStep } from "@aomi-labs/client/trace";

export type Status = "success" | "waiting" | "failed";

export function statusOf(step: InterpretedToolStep): Status {
  if (step.failed || step.outcome === "failed" || step.outcome === "cancelled")
    return "failed";
  return step.outcome === "waiting" || step.icon === "pending"
    ? "waiting"
    : "success";
}

/** Each status key as the glyph a terminal draws for it. */
export const GLYPHS: Record<Status, string> = {
  success: "✓",
  waiting: "◐",
  failed: "✗",
};

const ESC = "\u001b[";
export const paint = {
  dim: (text: string) => `${ESC}2m${text}${ESC}22m`,
  bold: (text: string) => `${ESC}1m${text}${ESC}22m`,
  yellow: (text: string) => `${ESC}33m${text}${ESC}39m`,
  green: (text: string) => `${ESC}32m${text}${ESC}39m`,
  red: (text: string) => `${ESC}31m${text}${ESC}39m`,
  cyan: (text: string) => `${ESC}36m${text}${ESC}39m`,
};

export const chipsOf = (step: InterpretedToolStep) =>
  step.chips.map((chip) => chip.label).join(" · ");

/** One decoded step as one line: `✓ Simulate transaction  Base · 2 txs`. */
export function stepLine(step: InterpretedToolStep, color: boolean): string {
  const status = statusOf(step);
  const line = `${GLYPHS[status]} ${step.title.padEnd(21)} ${chipsOf(step)}`.trimEnd();
  if (!color) return line;
  return status === "waiting"
    ? paint.yellow(line)
    : status === "failed"
      ? paint.red(line)
      : paint.dim(line);
}
