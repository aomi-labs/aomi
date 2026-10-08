"use client";

import { useEffect } from "react";
import {
  displayQueries,
  fetchDisplayQuery,
  useAomiDisplayCache,
  type DisplayQuery,
} from "@aomi-labs/react";
import { useShellTransport } from "./transport";
import { skillCatalogQuery } from "../composer/capabilities/skill-catalog";
import { packageCatalogQuery } from "@/library/use-package-catalog";
import { accountProfileQuery } from "./account-overview";
import { accountAclQuery } from "./use-account-acl";

/**
 * Warm Library and Settings during idle time, with the same query
 * definitions their hooks use. No session creation or signing work.
 */
export function DisplayPrefetch() {
  const cache = useAomiDisplayCache();
  const request = useShellTransport().json;
  useEffect(() => {
    const api = cache?.apiClient;
    if (!cache || !api) return;
    const userId =
      cache.scope.account?.kind === "user" ? cache.scope.account.id : undefined;
    const queries: DisplayQuery<unknown>[] = [
      skillCatalogQuery(api, request),
      packageCatalogQuery(api, request),
      ...(userId
        ? [
            accountProfileQuery(request, userId),
            displayQueries.credits(api),
            packageCatalogQuery(api, request, userId),
            accountAclQuery(request, cache),
          ]
        : []),
    ];
    const warm = () => {
      for (const query of queries)
        void fetchDisplayQuery(cache, query).catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 0);
    return () => window.clearTimeout(id);
  }, [cache, request]);
  return null;
}
