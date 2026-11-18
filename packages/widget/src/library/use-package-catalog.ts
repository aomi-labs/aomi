"use client";

import { useDisplayQuery, type DisplayQuery } from "@aomi-labs/react";
import type { Aomi, AomiPackageCatalog } from "@aomi-labs/client";
import { useAomi, useShellAomi } from "@/account/transport";
import { loadFailure } from "./model";

/**
 * The Library rows for a thread's agent (`aomi/main` without a thread). A
 * guest reads the defaults; a signed-in account reads its own choices.
 */
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

export function usePackageCatalog(accountUserId?: string, threadId?: string) {
  const runtime = useAomi();
  const shell = useShellAomi();
  const query = useDisplayQuery(
    packageCatalogQuery(
      accountUserId ? shell : runtime,
      accountUserId,
      threadId,
    ),
  );
  return {
    catalog: query.data ?? null,
    failure: query.error
      ? loadFailure(query.error, accountUserId != null)
      : null,
    refetch: () => query.refetch(),
  };
}
