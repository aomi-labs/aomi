import {
  QueryClient,
  defaultShouldDehydrateQuery,
} from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";
import {
  controlPlaneRetryDelay,
  shouldRetryControlPlaneQuery,
} from "./lib/request-retry";
import { parseUrlSearch, stringifyUrlSearch } from "./lib/url-search";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 15 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: shouldRetryControlPlaneQuery,
        retryDelay: controlPlaneRetryDelay,
      },
      mutations: { retry: false },
      dehydrate: {
        shouldDehydrateQuery: (query) =>
          query.meta?.ssrSafe === true && defaultShouldDehydrateQuery(query),
        shouldDehydrateMutation: () => false,
      },
    },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    parseSearch: parseUrlSearch,
    stringifySearch: stringifyUrlSearch,
  });
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
