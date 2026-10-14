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
