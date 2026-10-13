/**
 * Router search (de)serializers that keep the hosts' textual query contract:
 * values stay strings and repeated keys become arrays, in URL order.
 */
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
  for (const [key, value] of Object.entries(search))
    for (const item of Array.isArray(value) ? value : [value])
      if (item != null) params.append(key, String(item));
  const query = params.toString();
  return query ? `?${query}` : "";
}
