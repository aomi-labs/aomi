"use client";

import {
  displayQueries,
  useDisplayQuery,
  usePrivateApps,
  type DisplayQuery,
} from "@aomi-labs/react";
import type { Aomi, AomiAppDescriptor } from "@aomi-labs/client";
import { useAomi, useShellAomi } from "@/account/transport";
import { explainPackageLoadError, toCatalogPackage } from "./packages-catalog";

/** The public app catalog, or a signed-in account's apps with install state. */
export function packageCatalogQuery(
  aomi: Aomi,
  accountUserId?: string,
): DisplayQuery<AomiAppDescriptor[]> {
  if (!accountUserId) return displayQueries.appCatalog(aomi);
  return {
    resource: "account-apps",
    parameters: ["library", accountUserId],
    fetcher: (signal) => aomi.account.apps.list({ signal }),
  };
}

export function usePackageCatalog(accountUserId?: string) {
  const privateApps = usePrivateApps();
  const runtime = useAomi();
  const shell = useShellAomi();
  const query = useDisplayQuery(
    packageCatalogQuery(accountUserId ? shell : runtime, accountUserId),
  );
  return {
    catalog: query.data
      ? [
          ...query.data.filter(
            (app) =>
              !privateApps.apps.some(
                (saved) =>
                  app.applicationId != null &&
                  String(saved.applicationId) === String(app.applicationId),
              ),
          ),
          ...privateApps.apps,
        ].map(toCatalogPackage)
      : null,
    error: query.error ? explainPackageLoadError(query.error) : null,
    retry: () => {
      void query.refetch();
    },
  };
}
