import type { MessageEvent } from "../agent/types";
import { CYAN, RESET, formatLogContent } from "./output";

export const MAX_TABLE_VALUE_WIDTH = 72;

export function truncateCell(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) return value;
  return `${value.slice(0, maxWidth - 1)}…`;
}

export function padRight(value: string, width: number): string {
  return value.padEnd(width, " ");
}

export function estimateTokenCount(messages: readonly MessageEvent[]): number {
  let totalChars = 0;
  for (const message of messages) {
    const content = formatLogContent(message.content);
    if (content) {
      totalChars += content.length + 1;
    }
  }
  return Math.round(totalChars / 4);
}

export function printKeyValueTable(
  rows: Array<[string, string]>,
  color: string = CYAN,
): void {
  const labels = rows.map(([label]) => label);
  const values = rows.map(([, value]) =>
    truncateCell(value, MAX_TABLE_VALUE_WIDTH),
  );

  const keyWidth = Math.max(
    "field".length,
    ...labels.map((label) => label.length),
  );
  const valueWidth = Math.max(
    "value".length,
    ...values.map((value) => value.length),
  );
  const border = `+${"-".repeat(keyWidth + 2)}+${"-".repeat(valueWidth + 2)}+`;

  console.log(`${color}${border}${RESET}`);
  console.log(
    `${color}| ${padRight("field", keyWidth)} | ${padRight("value", valueWidth)} |${RESET}`,
  );
  console.log(`${color}${border}${RESET}`);
  for (let i = 0; i < rows.length; i++) {
    console.log(
      `${color}| ${padRight(labels[i], keyWidth)} | ${padRight(values[i], valueWidth)} |${RESET}`,
    );
    console.log(`${color}${border}${RESET}`);
  }
}
