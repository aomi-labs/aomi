/** Node fetch omits Origin; widget challenges and sessions bind to it. */
export function createPortalOriginFetch(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  const portalOrigin = new URL(baseUrl).origin;
  return (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      baseUrl,
    );
    if (url.origin !== portalOrigin) return fetchImpl(input, init);
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set("origin", portalOrigin);
    return fetchImpl(input, { ...init, headers });
  };
}
