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
import {
  accountWalletsQuery,
  agentWalletsQuery,
  connectionsQuery,
} from "./account-queries";
import { accountSafetyQuery } from "./policy/transaction-safety-api";

/**
 * Warm Library and Settings during idle time, with the same query
 * definitions their hooks use. No session creation or signing work.
 */
export function DisplayPrefetch() {
  const cache = useAomiDisplayCache();
  const transport = useShellTransport();
  useEffect(() => {
    const api = cache?.aomi;
    if (!cache || !api) return;
    const shell = transport.aomi;
    const userId =
      cache.scope.account?.kind === "user" ? cache.scope.account.id : undefined;
    const queries: DisplayQuery<unknown>[] = [
      skillCatalogQuery(api),
      packageCatalogQuery(api),
      ...(userId
        ? [
            accountProfileQuery(transport, userId),
            displayQueries.credits(api),
            packageCatalogQuery(shell, userId),
            agentWalletsQuery(shell),
            accountWalletsQuery(shell),
            connectionsQuery(shell),
            accountSafetyQuery(shell.account.guard),
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
  }, [cache, transport]);
  return null;
}
