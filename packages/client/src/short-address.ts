/**
 * Middle-truncates an address, hash or key for display (`0x1234…abcd`).
 * Values that would not get at least two characters shorter come back whole,
 * so already-shortened fixtures and short ids pass through unchanged.
 */
export function shortAddress(
  value: string,
  visible: { head?: number; tail?: number } = {},
): string {
  const head = visible.head ?? 6;
  const tail = visible.tail ?? 4;
  if (value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
