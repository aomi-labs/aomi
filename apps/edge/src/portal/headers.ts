import type { HeaderPolicy } from "../kernel/proxy";

const CACHE_HEADERS = ["cache-control", "etag", "last-modified", "expires", "vary"];
// CDN directives let an edge cache share one response between callers, so
// only public, credential-free responses may carry them.
const CDN_CACHE_HEADERS = ["cdn-cache-control", "vercel-cdn-cache-control"];
const PAYMENT_HEADERS = ["payment-required", "payment-receipt", "payment-response"];

/** The Rust backend's /api routes, called with an account bearer. */
export const BACKEND_API_HEADERS: Required<HeaderPolicy> = {
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
export const AGENT_API_HEADERS: Required<HeaderPolicy> = {
  request: new Set([
    ...BACKEND_API_HEADERS.request,
    "if-none-match",
    "if-modified-since",
    "idempotency-key",
    "mcp-protocol-version",
    "x-aomi-run-budget-microusd",
    "x-request-id",
  ]),
  response: new Set([...BACKEND_API_HEADERS.response, "mcp-protocol-version"]),
};

/** Public, credential-free discovery documents. */
export const PUBLIC_DISCOVERY_HEADERS: Required<HeaderPolicy> = {
  request: new Set(["accept", "x-request-id"]),
  response: new Set([...CACHE_HEADERS, ...CDN_CACHE_HEADERS, "content-type", "x-request-id"]),
};
