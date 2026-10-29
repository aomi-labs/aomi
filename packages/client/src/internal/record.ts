import type { AomiWalletFamily } from "../types";

/** Narrow parsed JSON to a plain object, or undefined for anything else. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

/** Field readers for one response; each failure is `Invalid <subject> response: …`. */
export function responseReader(subject: string) {
  const invalid = (detail: string) =>
    new TypeError(`Invalid ${subject} response: ${detail}`);
  return {
    invalid,
    family(value: unknown): AomiWalletFamily {
      if (value === "evm" || value === "svm") return value;
      throw invalid(`unsupported family: ${String(value)}`);
    },
    /** Missing or null reads as empty. */
    list(value: unknown, field: string): unknown[] {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
      return value;
    },
    text(value: unknown, field: string): string {
      const text = stringValue(value);
      if (text === undefined) throw invalid(`${field} must be a string`);
      return text;
    },
  };
}
