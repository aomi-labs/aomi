/** Server handlers that forward every method to the Mintlify docs proxy. */
export function mintlifyRoute() {
  const proxy = async ({ request }: { request: Request }) => {
    const { proxyMintlify } = await import("@/server/mintlify-proxy");
    return proxyMintlify(request);
  };
  return {
    GET: proxy,
    HEAD: proxy,
    POST: proxy,
    PUT: proxy,
    PATCH: proxy,
    DELETE: proxy,
    OPTIONS: proxy,
  };
}
