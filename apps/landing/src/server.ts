import { createServerEntry } from "@tanstack/react-start/server-entry";
import {
  installNativeHttpMethods,
  trailingSlashRedirect,
} from "@aomi-labs/app-kit/http";
const startHandler = (async () => {
  const { routeTree } = await import("./routeTree.gen");
  installNativeHttpMethods(routeTree);
  return (await import("@tanstack/react-start/server-entry")).default;
})();
export default createServerEntry({
  async fetch(request, options) {
    const redirect = trailingSlashRedirect(request);
    if (redirect) return redirect;
    const response = await (await startHandler).fetch(request, options);
    if (new URL(request.url).pathname !== "/embed-playground") return response;
    const headers = new Headers(response.headers);
    headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'self' https://aomilabs.mintlify.app https://*.mintlify.app",
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
});
