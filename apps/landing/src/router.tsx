import {
  QueryClient,
  defaultShouldDehydrateQuery,
} from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          query.meta?.ssrSafe === true && defaultShouldDehydrateQuery(query),
        shouldDehydrateMutation: () => false,
      },
    },
  });
  const router = createRouter({
    routeTree,
    caseSensitive: true,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
