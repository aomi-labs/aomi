"use client";

import { useDisplayQuery, type DisplayQuery } from "@aomi-labs/react";
import {
  parsePackageCatalog,
  type Aomi,
  type AomiPackageCatalog,
  type AomiPublicPackage,
} from "@aomi-labs/client";
import { useAomi, useShellAomi } from "@/account/transport";
import { loadFailure, type LoadFailure } from "./model";

/** The Library rows for a thread's agent (`aomi/main` without a thread). */
export function packageCatalogQuery(
  aomi: Aomi,
  accountUserId?: string,
  threadId?: string,
): DisplayQuery<AomiPackageCatalog> {
  return {
    resource: "account-packages",
    parameters: ["library", accountUserId ?? "guest", threadId ?? ""],
    fetcher: (signal) => aomi.account.packages.list({ threadId, signal }),
  };
}

/** The listed packages anyone may read, each with its skills. */
export function publicPackageQuery(
  aomi: Aomi,
): DisplayQuery<AomiPublicPackage[]> {
  return {
    resource: "packages",
    fetcher: (signal) =>
      aomi.raw
        .getPublicCatalog("packages", { signal })
        .then(parsePackageCatalog),
  };
}

/**
 * A signed-in account reads its own rows, with choices and keys. A guest reads
 * the public catalog: listed packages only, nothing tied to an account.
 */
export function usePackageCatalog(accountUserId?: string, threadId?: string) {
  const signedIn = accountUserId != null;
  const account = useDisplayQuery({
    ...packageCatalogQuery(useShellAomi(), accountUserId, threadId),
    enabled: signedIn,
  });
  const guest = useDisplayQuery({
    ...publicPackageQuery(useAomi()),
    enabled: !signedIn,
  });
  const query = signedIn ? account : guest;
  const rows: readonly AomiPublicPackage[] | null = signedIn
    ? (account.data?.packages ?? null)
    : (guest.data ?? null);
  const failure: LoadFailure | null = query.error
    ? signedIn
      ? loadFailure(query.error)
      : "failed"
    : null;
  return {
    rows,
    agent: account.data?.agent.display_name ?? "Your agent",
    failure,
    refetch: () => query.refetch(),
  };
}
