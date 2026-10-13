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
    return redirect ?? (await (await startHandler).fetch(request, options));
  },
});
