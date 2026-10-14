/** Keep the host's existing textual, repeated-query-parameter contract. */
export function parseUrlSearch(
  search: string,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of new URLSearchParams(search)) {
    const previous = result[key];
    result[key] =
      previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
  }
  return result;
}

export function stringifyUrlSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) {
      for (const item of value)
        if (item != null) params.append(key, String(item));
    } else if (value != null) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
