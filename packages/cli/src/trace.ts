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
  italic: (text: string) => `${ESC}3m${text}${ESC}23m`,
  underline: (text: string) => `${ESC}4m${text}${ESC}24m`,
  strike: (text: string) => `${ESC}9m${text}${ESC}29m`,
};

const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]+/gu;

/** Text from a package, a token or a message, with nothing a terminal acts on. */
export const plain = (text: string) => text.replace(CONTROL, " ");

/** The same, its lines and tabs kept. */
export const plainText = (text: string) =>
  text.replace(CONTROL, (run) => run.replace(/[^\n\t]/gu, " "));

export const titleOf = (step: InterpretedToolStep) => plain(step.title);

export const chipsOf = (step: InterpretedToolStep) =>
  plain(step.chips.map((chip) => chip.label).join(" · "));

/** One decoded step as one line: `✓ Simulate transaction  Base · 2 txs`. */
export function stepLine(step: InterpretedToolStep, color: boolean): string {
  const status = statusOf(step);
  const line =
    `${GLYPHS[status]} ${titleOf(step).padEnd(21)} ${chipsOf(step)}`.trimEnd();
  if (!color) return line;
  return status === "waiting"
    ? paint.yellow(line)
    : status === "failed"
      ? paint.red(line)
      : paint.dim(line);
}
