export function parseUrlSearch(search: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  const params = new URLSearchParams(search);
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    result[key] = values.length === 1 ? values[0] : values;
  }
  return result;
}
export function stringifyUrlSearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined || value === null) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, String(entry));
  }
  return params.size ? `?${params}` : "";
}
