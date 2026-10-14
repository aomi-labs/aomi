/** Which headers cross the BFF in each direction for one kind of upstream. */
export type HeaderPolicy = {
  request: ReadonlySet<string>;
  response: ReadonlySet<string>;
};

const CACHE_HEADERS = [
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "vary",
];
// CDN directives let an edge cache share one response between callers, so
// only public, credential-free responses may carry them.
const CDN_CACHE_HEADERS = ["cdn-cache-control", "vercel-cdn-cache-control"];
const PAYMENT_HEADERS = [
  "payment-required",
  "payment-receipt",
  "payment-response",
];

/** The Rust backend's /api routes, called with an account bearer. */
export const BACKEND_API_HEADERS: HeaderPolicy = {
  request: new Set([
    "accept",
    "content-type",
    "aomi-app-key",
    "payment-signature",
    "x-session-id",
    "x-thread-id",
  ]),
  response: new Set([
    ...CACHE_HEADERS,
    ...PAYMENT_HEADERS,
    "content-type",
    "location",
    "retry-after",
    "server-timing",
    "x-accel-buffering",
    "x-request-id",
  ]),
};

/** The agent API (agent, pipeline, MCP and account routes), called with a scoped bearer. */
export const AGENT_API_HEADERS: HeaderPolicy = {
  request: new Set([
    ...BACKEND_API_HEADERS.request,
    "if-none-match",
    "if-modified-since",
    "idempotency-key",
    "mcp-protocol-version",
    "x-aomi-inference-funding",
    "x-request-id",
  ]),
  response: new Set([...BACKEND_API_HEADERS.response, "mcp-protocol-version"]),
};

/** Public, credential-free discovery documents. */
export const PUBLIC_DISCOVERY_HEADERS: HeaderPolicy = {
  request: new Set(["accept", "x-request-id"]),
  response: new Set([
    ...CACHE_HEADERS,
    ...CDN_CACHE_HEADERS,
    "content-type",
    "x-request-id",
  ]),
};

/** The upstream could not be reached at all, as opposed to answering with an error. */
export class UpstreamUnreachableError extends Error {
  constructor(cause: unknown) {
    super("upstream_unreachable", { cause });
    this.name = "UpstreamUnreachableError";
  }
}

const READS = new Set(["GET", "HEAD"]);

/**
 * Forward a request upstream with only the policy's headers in each direction.
 * Cookies and the caller's Authorization never cross; `bearer` replaces them.
 */
export async function forward(input: {
  request: Request;
  url: URL;
  policy: HeaderPolicy;
  bearer?: string;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  const { request, policy } = input;
  const headers = pickHeaders(request.headers, policy.request);
  const threadId = headers.get("x-session-id");
  if (
    threadId &&
    policy.request.has("x-thread-id") &&
    !headers.has("x-thread-id")
  )
    headers.set("x-thread-id", threadId);
  if (input.bearer) headers.set("authorization", `Bearer ${input.bearer}`);
  const read = READS.has(request.method);
  let upstream: Response;
  try {
    upstream = await (input.fetchImpl ?? fetch)(input.url, {
      method: request.method,
      headers,
      body: read ? undefined : request.body,
      // A client that disconnects may stop a read or a stream, but never a
      // write that has already reached the upstream.
      signal: read ? request.signal : undefined,
      cache: "no-store",
      redirect: "manual",
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (error) {
    throw new UpstreamUnreachableError(error);
  }
  const responseHeaders = pickHeaders(upstream.headers, policy.response);
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    responseHeaders.set("cache-control", "no-cache, no-transform");
    for (const name of CDN_CACHE_HEADERS) responseHeaders.delete(name);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function pickHeaders(source: Headers, allowed: ReadonlySet<string>): Headers {
  const headers = new Headers();
  source.forEach((value, name) => {
    if (allowed.has(name.toLowerCase())) headers.set(name, value);
  });
  return headers;
}
