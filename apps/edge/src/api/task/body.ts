/**
 * The Task build body as a venue sent it versus as the API Server wants it.
 * The API Server's JSON extractor answers 415 to any media type other than
 * `application/json` and 422 to an empty body. Venues probe with both. The
 * adapter is a pure function of the bytes: a retry carrying
 * `Payment-Signature` reproduces the same canonical body, so the quote stays
 * bound to it.
 */
export type TaskBody =
  | { kind: "empty" }
  | { kind: "json"; request: Request }
  | { kind: "opaque"; request: Request };

function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "application/json" || type.endsWith("+json");
}

export async function normaliseTaskBody(request: Request): Promise<TaskBody> {
  const text = await request.clone().text();
  if (text.trim().length === 0) return { kind: "empty" };
  if (isJsonMediaType(request.headers.get("content-type"))) {
    return { kind: "json", request };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON at all: the API Server's own 415 is the honest answer.
    return { kind: "opaque", request };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "opaque", request };
  }
  // Same bytes, the right label. Re-serialising would also be deterministic,
  // but the venue's bytes are what it will sign a retry against.
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return {
    kind: "json",
    request: new Request(request.url, {
      method: request.method,
      headers,
      body: text,
    }),
  };
}
