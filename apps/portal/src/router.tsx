import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import {
  parseUrlSearch,
  stringifyUrlSearch,
} from "@aomi-labs/app-kit/url-search";

export function getRouter() {
  return createRouter({
    routeTree,
    caseSensitive: true,
    parseSearch: parseUrlSearch,
    stringifySearch: stringifyUrlSearch,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
