/**
 * JSON with the key order the backend wrote. Venues cache and hash the Task
 * documents, so the edge reproduces them byte for byte, and a plain
 * `JSON.parse` cannot: JS objects enumerate integer-like keys ("402", "404")
 * first, in numeric order, whatever order the source had. Objects parsed here
 * are `Ordered` maps; plain objects (the edge's own literals) serialise in
 * their enumeration order, so literals must not rely on integer-key order.
 */
export class Ordered extends Map<string, unknown> {
  /** The child at `key`, which must be an object. */
  at(key: string): Ordered {
    const child = this.get(key);
    if (!(child instanceof Ordered)) throw new Error(`expected an object at ${key}`);
    return child;
  }
}

/** Parse JSON keeping each object's key order. Invalid JSON throws, as `JSON.parse` does. */
export function parseOrdered(text: string): unknown {
  JSON.parse(text); // validates; the walk below then trusts the grammar
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i += 1;
  };
  const value = (): unknown => {
    ws();
    const c = text[i];
    if (c === "{") {
      i += 1;
      const object = new Ordered();
      ws();
      if (text[i] === "}") return (i += 1), object;
      for (;;) {
        ws();
        const key = string();
        ws();
        i += 1; // :
        object.set(key, value());
        ws();
        if (text[i++] === "}") return object;
      }
    }
    if (c === "[") {
      i += 1;
      const array: unknown[] = [];
      ws();
      if (text[i] === "]") return (i += 1), array;
      for (;;) {
        array.push(value());
        ws();
        if (text[i++] === "]") return array;
      }
    }
    if (c === '"') return string();
    const start = i;
    while (i < text.length && !",}] \t\n\r".includes(text[i])) i += 1;
    return JSON.parse(text.slice(start, i));
  };
  const string = (): string => {
    const start = i;
    i += 1;
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    i += 1;
    return JSON.parse(text.slice(start, i)) as string;
  };
  return value();
}

/** Compact JSON, as serde_json writes it. */
export function stringifyOrdered(value: unknown): string {
  if (value instanceof Map) return `{${[...value].map(([k, v]) => `${JSON.stringify(k)}:${stringifyOrdered(v)}`).join(",")}}`;
  if (Array.isArray(value)) return `[${value.map(stringifyOrdered).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}:${stringifyOrdered(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * Compact JSON with object keys in byte order: serde_json's output for a
 * binary built without `preserve_order` (Payment is).
 */
export function sortedJson(value: unknown): string {
  return stringifyOrdered(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value instanceof Map || (value && typeof value === "object")) {
    const entries = value instanceof Map ? [...value] : Object.entries(value as object);
    return new Ordered(entries.sort(([a], [b]) => byBytes(a, b)).map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

const encoder = new TextEncoder();

function byBytes(a: string, b: string): number {
  const [x, y] = [encoder.encode(a), encoder.encode(b)];
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** A JSON response as the API Server's `Json` extractor writes it. */
export function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  const response = new Response(stringifyOrdered(value), { status, headers });
  response.headers.set("content-type", "application/json");
  return response;
}

/** A deep copy that keeps `Ordered` maps ordered. */
export function copy<T>(value: T): T {
  if (value instanceof Map) return new Ordered([...value].map(([k, v]) => [k, copy(v)])) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T;
  return value;
}
