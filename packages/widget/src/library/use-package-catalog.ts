"use client";

import {
  displayQueries,
  useDisplayQuery,
  useAomiDisplayCache,
  type DisplayQuery,
} from "@aomi-labs/react";
import type { AomiAppDescriptor, AomiClient } from "@aomi-labs/client";
import { useShellTransport, type ShellRequest } from "@/account/transport";
import { fetchAppCatalog } from "@/account/shell/packages-api";
import { explainPackageLoadError, toCatalogPackage } from "./packages-catalog";

/** The public app catalog, or a signed-in account's apps with install state. */
export function packageCatalogQuery(
  api: AomiClient | undefined,
  request: ShellRequest,
  accountUserId?: string,
): DisplayQuery<AomiAppDescriptor[]> {
  if (api && !accountUserId) return displayQueries.appCatalog(api);
  return {
    resource: accountUserId ? "account-apps" : "app-catalog",
    parameters: ["library", accountUserId ?? "guest"],
    fetcher: (signal) => fetchAppCatalog(accountUserId, request, signal),
  };
}

export function usePackageCatalog(accountUserId?: string) {
  const transport = useShellTransport();
  const api = useAomiDisplayCache()?.apiClient;
  const query = useDisplayQuery(
    packageCatalogQuery(api, transport.json, accountUserId),
  );
  return {
    catalog: query.data?.map(toCatalogPackage) ?? null,
    error: query.error ? explainPackageLoadError(query.error) : null,
    retry: () => {
      void query.refetch();
    },
  };
}
