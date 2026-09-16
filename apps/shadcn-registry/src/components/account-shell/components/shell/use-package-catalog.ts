"use client";

import { useCallback, useEffect, useState } from "react";
import { useShellTransport } from "../../transport";
import { fetchAppCatalog } from "./packages-api";
import {
  explainPackageLoadError,
  toCatalogPackage,
  type CatalogPackage,
} from "./packages-catalog";

export function usePackageCatalog(accountUserId?: string) {
  const transport = useShellTransport();
  const [catalog, setCatalog] = useState<{
    accountUserId?: string;
    entries: CatalogPackage[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setError(null);

    fetchAppCatalog(accountUserId, transport.json)
      .then((apps) => {
        if (!cancelled)
          setCatalog({ accountUserId, entries: apps.map(toCatalogPackage) });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(explainPackageLoadError(cause));
      });

    return () => {
      cancelled = true;
    };
  }, [request, accountUserId, transport]);

  const retry = useCallback(() => {
    setRequest((current) => current + 1);
  }, []);

  return {
    catalog:
      catalog && catalog.accountUserId === accountUserId
        ? catalog.entries
        : null,
    error,
    retry,
  };
}
